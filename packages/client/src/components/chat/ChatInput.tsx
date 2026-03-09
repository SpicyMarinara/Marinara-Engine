// ──────────────────────────────────────────────
// Chat: Input — mode-aware styling
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Loader2, Paperclip, StopCircle, X } from "lucide-react";
import { toast } from "sonner";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useGenerate } from "../../hooks/use-generate";
import { useApplyRegex } from "../../hooks/use-apply-regex";
import { useCreateMessage } from "../../hooks/use-chats";
import {
  matchSlashCommand,
  getSlashCompletions,
  type SlashCommand,
  type SlashCommandContext,
} from "../../lib/slash-commands";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  mode?: "conversation" | "roleplay";
  characterNames?: string[];
}

export function ChatInput({ mode = "conversation", characterNames = [] }: ChatInputProps) {
  const [hasInput, setHasInput] = useState(false);
  const [completions, setCompletions] = useState<SlashCommand[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const { generate } = useGenerate();
  const { applyToUserInput } = useApplyRegex();
  const enterToSend = useUIStore((s) => s.enterToSend);
  const createMessage = useCreateMessage(activeChatId);

  // Normalize curly/smart quotes to straight quotes
  const normalizeQuotes = (s: string) => s.replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'");

  // Get the current textarea value (always from the DOM directly)
  const getValue = () => textareaRef.current?.value ?? "";

  const buildContext = useCallback((): SlashCommandContext | null => {
    if (!activeChatId) return null;
    return {
      chatId: activeChatId,
      generate,
      createMessage: (data) => createMessage.mutate(data),
      invalidate: () => {},
      characterNames,
    };
  }, [activeChatId, generate, createMessage, characterNames]);

  const handleSend = useCallback(async () => {
    const raw = getValue();
    if (!raw.trim() || !activeChatId || isStreaming) return;

    const normalized = normalizeQuotes(raw.trim());

    // Check for slash command
    const match = matchSlashCommand(normalized);
    if (match) {
      const ctx = buildContext();
      if (!ctx) return;

      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      setHasInput(false);
      setCompletions([]);

      const result = await match.command.execute(match.args, ctx);
      if (result.feedback) {
        setFeedback(result.feedback);
      }
      return;
    }

    // Check if the chat has a connection configured
    const chat = useChatStore.getState().activeChat;
    if (chat && !chat.connectionId) {
      toast.error(
        "It looks like you haven't connected any model yet. Please head to Chat Settings in the top right corner to do that first!",
      );
      return;
    }

    const message = applyToUserInput(normalized);

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    setHasInput(false);
    setCompletions([]);

    try {
      await generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: message,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Generation failed";
      toast.error(msg);
      console.error("Send failed:", error);
    }
  }, [activeChatId, isStreaming, generate, applyToUserInput, buildContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete navigation
    if (completions.length > 0) {
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const cmd = completions[selectedCompletion];
        if (cmd && textareaRef.current) {
          textareaRef.current.value = `/${cmd.name} `;
          handleInput();
        }
        setCompletions([]);
        setSelectedCompletion(0);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCompletion((prev) => (prev > 0 ? prev - 1 : completions.length - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCompletion((prev) => (prev < completions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "Escape") {
        setCompletions([]);
        setSelectedCompletion(0);
        return;
      }
    }

    if (enterToSend && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    // Normalize smart quotes directly in the DOM
    const raw = el.value;
    const fixed = normalizeQuotes(raw);
    if (raw !== fixed) {
      const pos = el.selectionStart;
      el.value = fixed;
      el.setSelectionRange(pos, pos);
    }
    setHasInput(fixed.trim().length > 0);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";

    // Slash command autocomplete
    const trimmed = fixed.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const matches = getSlashCompletions(trimmed);
      setCompletions(matches);
      setSelectedCompletion(0);
    } else {
      setCompletions([]);
    }
  };

  // Dismiss feedback on new input
  useEffect(() => {
    if (hasInput && feedback) setFeedback(null);
  }, [hasInput, feedback]);

  const isRP = mode === "roleplay";

  return (
    <div className={cn("chat-input-container", isRP ? "p-3" : "border-t p-3 glass-strong border-[var(--border)]")}>
      {/* Slash command autocomplete popup */}
      {completions.length > 0 && (
        <div
          className={cn(
            "mb-2 overflow-hidden rounded-xl border shadow-xl",
            isRP ? "border-white/10 bg-black/80 backdrop-blur-xl" : "border-[var(--border)] bg-[var(--background)]",
          )}
        >
          {completions.map((cmd, i) => (
            <button
              key={cmd.name}
              onMouseDown={(e) => {
                e.preventDefault();
                if (textareaRef.current) {
                  textareaRef.current.value = `/${cmd.name} `;
                  handleInput();
                  textareaRef.current.focus();
                }
                setCompletions([]);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                i === selectedCompletion
                  ? isRP
                    ? "bg-white/10 text-white"
                    : "bg-[var(--accent)] text-[var(--foreground)]"
                  : isRP
                    ? "text-white/70 hover:bg-white/5"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              <span className={cn("font-mono font-semibold", isRP ? "text-blue-400" : "text-[var(--primary)]")}>
                /{cmd.name}
              </span>
              <span className="text-xs opacity-60">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div
          className={cn(
            "mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
            isRP ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800",
          )}
        >
          <span className="flex-1 whitespace-pre-wrap">{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Main input container */}
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-2xl border-2 px-4 py-3 transition-all duration-200",
          isRP
            ? cn("bg-black/40", hasInput ? "border-blue-400/30 shadow-md shadow-blue-500/5" : "border-white/10")
            : cn(
                "bg-[var(--secondary)]",
                hasInput
                  ? "border-[var(--primary)]/40 shadow-md shadow-[var(--primary)]/5"
                  : "border-[var(--border)]/40",
              ),
        )}
      >
        {/* Attachment button */}
        <button
          className={cn(
            "rounded-lg p-1.5 transition-all active:scale-90",
            isRP
              ? "text-white/40 hover:bg-white/10 hover:text-white/70"
              : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
          )}
          title="Attach file"
        >
          <Paperclip size={16} />
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            activeChatId
              ? isRP
                ? "What do you do? — Press Enter to send, / for commands"
                : "Type a message... — Press Enter to send, / for commands"
              : "Select a chat first"
          }
          disabled={!activeChatId}
          rows={1}
          spellCheck={false}
          autoCorrect="off"
          className={cn(
            "max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-40",
            isRP
              ? "text-white/90 placeholder:text-white/30"
              : "text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]",
          )}
        />

        {/* Send / Stop button */}
        <button
          onClick={isStreaming ? () => useChatStore.getState().stopGeneration() : handleSend}
          disabled={(!hasInput && !isStreaming) || !activeChatId}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
            isStreaming
              ? "bg-[var(--destructive)] text-white hover:opacity-80"
              : hasInput && activeChatId
                ? isRP
                  ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20 hover:shadow-lg active:scale-90"
                  : "bg-gradient-to-br from-[var(--primary)] to-blue-600 text-white shadow-md shadow-[var(--primary)]/20 hover:shadow-lg active:scale-90"
                : isRP
                  ? "text-white/20"
                  : "text-[var(--muted-foreground)]",
          )}
        >
          {isStreaming ? <StopCircle size={16} /> : <Send size={15} className={cn(hasInput && "translate-x-[1px]")} />}
        </button>
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div
          className={cn(
            "mt-1.5 flex items-center justify-end px-3 text-[10px]",
            isRP ? "text-blue-400" : "text-[var(--primary)]",
          )}
        >
          <span className="flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" />
            Generating...
          </span>
        </div>
      )}
    </div>
  );
}
