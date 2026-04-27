// ──────────────────────────────────────────────
// Chat: Conversation Input — Discord-style
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Smile, StopCircle, X, Plus, ImagePlay, AtSign } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useGenerate } from "../../hooks/use-generate";
import { useApplyRegex } from "../../hooks/use-apply-regex";
import { useCreateMessage, useChat, chatKeys } from "../../hooks/use-chats";
import { characterKeys } from "../../hooks/use-characters";
import {
  matchSlashCommand,
  getSlashCompletions,
  type SlashCommand,
  type SlashCommandContext,
} from "../../lib/slash-commands";
import { resolveInputMacrosForChat } from "../../lib/chat-macros";
import { cn } from "../../lib/utils";
import { QuickConnectionSwitcher } from "./QuickConnectionSwitcher";
import { QuickPersonaSwitcher } from "./QuickPersonaSwitcher";
import { QuickSwitcherMobile } from "./QuickSwitcherMobile";
import { EmojiPicker } from "../ui/EmojiPicker";
import { GifPicker } from "../ui/GifPicker";
import { MariThinkingIndicator } from "./MariThinkingIndicator";

interface Attachment {
  type: string;
  data: string;
  name: string;
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
}

export function ConversationInput({ characterNames = [] }: ConversationInputProps) {
  const [hasInput, setHasInput] = useState(false);
  const [completions, setCompletions] = useState<SlashCommand[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // @mention autocomplete
  const [_mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCompletions, setMentionCompletions] = useState<string[]>([]);
  const [selectedMention, setSelectedMention] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
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
  const { generate } = useGenerate();
  const { applyToUserInput } = useApplyRegex();
  const enterToSend = useUIStore((s) => s.enterToSendConvo);
  const createMessage = useCreateMessage(activeChatId);
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore draft
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      if (prevChatIdRef.current && textareaRef.current?.value) {
        setInputDraft(prevChatIdRef.current, textareaRef.current.value);
      }
      prevChatIdRef.current = activeChatId;
      if (textareaRef.current) {
        const draft = activeChatId ? (useChatStore.getState().inputDrafts.get(activeChatId) ?? "") : "";
        textareaRef.current.value = draft;
        setHasInput(draft.length > 0);
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }
    }
  }, [activeChatId, setInputDraft]);

  // Save draft on unmount
  useEffect(() => {
    const el = textareaRef.current;
    return () => {
      const id = prevChatIdRef.current;
      if (id && el?.value) {
        useChatStore.getState().setInputDraft(id, el.value);
      }
    };
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const MAX_SIZE = 20 * 1024 * 1024;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} exceeds 20 MB limit`);
        continue;
      }
      // Convert GIFs to PNG (Gemini and some providers don't support image/gif)
      if (file.type === "image/gif") {
        try {
          const { dataUrl } = await convertToPng(file);
          setAttachments((prev) => [
            ...prev,
            { type: "image/png", data: dataUrl, name: file.name.replace(/\.gif$/i, ".png") },
          ]);
        } catch {
          toast.error(`Failed to convert ${file.name}`);
        }
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { type: file.type, data: reader.result as string, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || !activeChatId) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        for (const f of imageFiles) dt.items.add(f);
        handleFileUpload(dt.files);
      }
    },
    [activeChatId, handleFileUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!activeChatId) return;
      const imageFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        const dt = new DataTransfer();
        for (const f of imageFiles) dt.items.add(f);
        handleFileUpload(dt.files);
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
      setHasInput(el.value.length > 0);
      setMentionQuery(null);
      setMentionCompletions([]);
      el.focus();
    },
    [mentionStartPos],
  );

  const handleSend = useCallback(async () => {
    if (!activeChatId) return;
    const raw = textareaRef.current?.value.trim() ?? "";
    if (!raw && attachments.length === 0) {
      return;
    }
    // If already generating for this chat, just save the message without
    // triggering another generation — the in-progress generation will see
    // it (server re-reads messages after any busy delay).
    if (isStreaming) {
      let message = applyToUserInput(raw);
      // Input translation for streaming path too
      const activeChatData = useChatStore.getState().activeChat;
      const streamMeta = activeChatData?.metadata
        ? typeof activeChatData.metadata === "string"
          ? JSON.parse(activeChatData.metadata)
          : activeChatData.metadata
        : {};
      if (streamMeta.translateInput && message.trim()) {
        try {
          const { translateText } = await import("../../lib/translate-text");
          const translated = await translateText(message);
          if (translated.trim()) message = translated;
        } catch {
          toast.error("Failed to translate message — sending original");
        }
      }
      const cachedCharacters = qc.getQueryData<Array<{ id: string; data: unknown }>>(characterKeys.list());
      const cachedPersonas = qc.getQueryData<Array<Record<string, unknown>>>(characterKeys.personas);
      message = resolveInputMacrosForChat(message, activeChatData, cachedCharacters, cachedPersonas);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      setHasInput(false);
      clearInputDraft(activeChatId);
      const currentAttachments = [...attachments];
      setAttachments([]);
      createMessage.mutate({
        role: "user",
        content: message,
        characterId: null,
        ...(currentAttachments.length > 0 && { attachments: currentAttachments }),
      });
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
      if (textareaRef.current) textareaRef.current.value = "";
      setHasInput(false);
      clearInputDraft(activeChatId);
      setAttachments([]);
      const result = await matched.command.execute(matched.args, slashCtx);
      if (result.feedback) {
        setFeedback(result.feedback);
      }
      return;
    }

    let message = applyToUserInput(raw);

    // Input translation: translate user's message before sending
    const activeChat = useChatStore.getState().activeChat;
    const chatMeta = activeChat?.metadata
      ? typeof activeChat.metadata === "string"
        ? JSON.parse(activeChat.metadata)
        : activeChat.metadata
      : {};
    if (chatMeta.translateInput && message.trim()) {
      try {
        const { translateText } = await import("../../lib/translate-text");
        const translated = await translateText(message);
        if (translated.trim()) message = translated;
      } catch {
        toast.error("Failed to translate message — sending original");
      }
    }

    const cachedCharacters = qc.getQueryData<Array<{ id: string; data: unknown }>>(characterKeys.list());
    const cachedPersonas = qc.getQueryData<Array<Record<string, unknown>>>(characterKeys.personas);
    message = resolveInputMacrosForChat(message, activeChat, cachedCharacters, cachedPersonas);

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    setHasInput(false);
    clearInputDraft(activeChatId);

    const pendingAttachments = attachments.map((a) => ({ type: a.type, data: a.data }));
    setAttachments([]);

    // Extract @mentions from the raw message (before regex transforms)
    const mentioned = extractMentions(raw);

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
    isStreaming,
    generate,
    applyToUserInput,
    extractMentions,
    clearInputDraft,
    createMessage,
    characterNames,
    qc,
  ]);

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
            setHasInput(true);
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
    [completions, selectedCompletion, mentionCompletions, selectedMention, insertMention, enterToSend, handleSend],
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
    setHasInput(el.value.length > 0);

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
  }, [characterNames]);

  useEffect(() => {
    if (hasInput && feedback) setFeedback(null);
  }, [hasInput, feedback]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    el.value = value.slice(0, start) + emoji + value.slice(end);
    el.selectionStart = el.selectionEnd = start + emoji.length;
    setHasInput(el.value.length > 0);
    el.focus();
  }, []);

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

      await generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: gifUrl,
        ...(gifAttachments ? { attachments: gifAttachments } : {}),
      });
    },
    [activeChatId, isStreaming, generate, createMessage],
  );

  return (
    <div className="relative px-3 pb-3">
      {/* Slash command autocomplete */}
      {completions.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {completions.map((cmd, i) => (
            <button
              key={cmd.name}
              onMouseDown={(e) => {
                e.preventDefault();
                if (textareaRef.current) {
                  textareaRef.current.value = `/${cmd.name} `;
                  setHasInput(true);
                  setCompletions([]);
                  textareaRef.current.focus();
                }
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                i === selectedCompletion ? "bg-foreground/10 text-foreground" : "hover:bg-[var(--accent)]",
              )}
            >
              <span className="font-mono text-xs">/{cmd.name}</span>
              {cmd.description && (
                <span className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">{cmd.description}</span>
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
        <div className="absolute bottom-full left-3 right-3 mb-2 flex justify-center">
          <div className="flex w-full items-start gap-2 rounded-lg bg-foreground/15 px-3 py-2 text-xs font-medium text-foreground shadow-md">
            <span className="flex-1 whitespace-pre-wrap">{feedback}</span>
            <button
              onClick={() => setFeedback(null)}
              className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size="0.75rem" />
            </button>
          </div>
        </div>
      )}

      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)]"
            >
              <span className="max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                className="rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
              >
                <X size="0.625rem" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mari command-execution indicator */}
      <MariThinkingIndicator />

      {/* Input bar */}
      <div
        ref={inputBarRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex items-center gap-1.5 rounded-2xl border-2 px-2.5 py-2.5 transition-all duration-200 sm:gap-2 sm:px-4 bg-black/40",
          isDragging ? "border-blue-400/50 bg-blue-500/10 shadow-lg shadow-blue-500/10" : "border-foreground/25",
        )}
      >
        {/* Attach button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
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
            characterNames.length > 1 && chatName
              ? `Message ${chatName}, / for commands`
              : characterNames.length > 0
                ? `Message @${characterNames[0]}, / for commands`
                : "Message..."
          }
          rows={1}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="max-h-[12.5rem] min-w-0 flex-1 resize-none bg-transparent py-0 text-[1rem] leading-normal text-[#c3c2c2] outline-none placeholder:text-foreground/30"
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

          <button
            onClick={isActuallyGenerating ? () => useChatStore.getState().stopGeneration() : handleSend}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
              isActuallyGenerating
                ? "text-foreground hover:opacity-80"
                : hasInput || attachments.length > 0
                  ? "text-foreground hover:text-foreground/80 active:scale-90"
                  : "text-foreground/20",
            )}
            title={isActuallyGenerating ? "Stop generating" : "Send"}
          >
            {isActuallyGenerating ? <StopCircle size="1rem" /> : <Send size="0.9375rem" />}
          </button>
        </div>
      </div>
    </div>
  );
}
