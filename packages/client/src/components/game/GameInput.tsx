// ──────────────────────────────────────────────
// Game: Input Bar (send message, roll dice, attach files, emoji)
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { Send, Dices, Paperclip, Smile, Users, MessageCircle, MessageSquare } from "lucide-react";
import { cn } from "../../lib/utils";
import { EmojiPicker } from "../ui/EmojiPicker";
import { useUIStore } from "../../stores/ui.store";

interface Attachment {
  type: string;
  data: string;
  name: string;
}

type AddressMode = "scene" | "party" | "gm";

interface GameInputProps {
  onSend: (
    message: string,
    attachments?: Array<{ type: string; data: string }>,
    options?: { commitPendingMove?: boolean },
  ) => void;
  onRollDice: (notation: string) => void;
  /** When true, allow "Talk to Party" in the address selector. */
  hasPartyMembers?: boolean;
  /** Pending staged destination from the map UI. */
  pendingMoveLabel?: string | null;
  /** Clear the staged destination without sending it. */
  onClearPendingMove?: () => void;
  disabled: boolean;
  isStreaming: boolean;
  /** When true, renders without the bottom-bar chrome (for embedding inside narration box) */
  inline?: boolean;
  /** Key for persisting the input draft to sessionStorage (e.g. chatId) */
  draftKey?: string;
}

const QUICK_DICE = ["d20", "d6", "2d6", "d10", "d100", "d4", "d8", "d12"];

export function GameInput({
  onSend,
  onRollDice,
  hasPartyMembers,
  pendingMoveLabel,
  onClearPendingMove,
  disabled,
  isStreaming,
  inline,
  draftKey,
}: GameInputProps) {
  const enterToSend = useUIStore((s) => s.enterToSendGame);
  const storageKey = draftKey ? `game-input-draft:${draftKey}` : null;
  const [text, setText] = useState(() => {
    if (!storageKey) return "";
    try {
      return sessionStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [showDice, setShowDice] = useState(false);
  const [customDice, setCustomDice] = useState("");
  const [queuedDice, setQueuedDice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [addressMode, setAddressMode] = useState<AddressMode>("scene");
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const addressButtonRef = useRef<HTMLButtonElement>(null);
  const addressMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addressMode !== "party" || hasPartyMembers) return;
    setAddressMode("scene");
  }, [addressMode, hasPartyMembers]);

  useEffect(() => {
    if (!addressMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (addressButtonRef.current?.contains(target) || addressMenuRef.current?.contains(target)) return;
      setAddressMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [addressMenuOpen]);

  /** Update text state and persist draft */
  const updateText = useCallback(
    (value: string) => {
      setText(value);
      if (storageKey) {
        try {
          sessionStorage.setItem(storageKey, value);
        } catch {
          /* */
        }
      }
    },
    [storageKey],
  );

  /** Clear the persisted draft */
  const clearDraft = useCallback(() => {
    if (storageKey) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* */
      }
    }
  }, [storageKey]);

  const handleAddressModeSelect = useCallback((nextMode: Exclude<AddressMode, "scene">) => {
    setAddressMode((current) => (current === nextMode ? "scene" : nextMode));
    setAddressMenuOpen(false);
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const trimmed = text.trim();
    const commitPendingMove = !!pendingMoveLabel && addressMode === "scene";
    const hasTurnContent = trimmed.length > 0 || attachments.length > 0 || commitPendingMove || !!queuedDice;
    if (!hasTurnContent || disabled) return;

    let body = trimmed;
    if (commitPendingMove && pendingMoveLabel) {
      body = body ? `*moves to ${pendingMoveLabel}*\n${body}` : `*moves to ${pendingMoveLabel}*`;
    }

    const pendingAttachments =
      attachments.length > 0 ? attachments.map((a) => ({ type: a.type, data: a.data })) : undefined;

    if (queuedDice) {
      onRollDice(queuedDice);
      body = body ? `${body}\n[dice: ${queuedDice}]` : `[dice: ${queuedDice}]`;
      setQueuedDice(null);
    }

    if (addressMode === "party") {
      body = body ? `[To the party] ${body}` : "[To the party]";
    } else if (addressMode === "gm") {
      body = body ? `[To the GM] ${body}` : "[To the GM]";
    }

    onSend(body, pendingAttachments, { commitPendingMove });

    setText("");
    clearDraft();
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const shouldSend = enterToSend ? e.key === "Enter" && !e.shiftKey : e.key === "Enter" && (e.metaKey || e.ctrlKey);
    if (shouldSend) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDiceRoll = (notation: string) => {
    setQueuedDice(notation);
    setShowDice(false);
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [...prev, { type: file.type, data: reader.result as string, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  }, []);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      if (!inputRef.current) return;
      const el = inputRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;
      const newValue = value.slice(0, start) + emoji + value.slice(end);
      updateText(newValue);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + emoji.length;
        el.focus();
      });
    },
    [updateText],
  );

  return (
    <div
      className={inline ? "" : "border-t border-[var(--border)] bg-[var(--card)]"}
      style={inline ? undefined : { minHeight: 61 }}
    >
      {/* Dice picker */}
      {showDice && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-2">
          {QUICK_DICE.map((d) => (
            <button
              key={d}
              onClick={() => handleDiceRoll(d)}
              className="rounded bg-white/10 px-2 py-1 text-xs font-mono text-white/70 hover:bg-white/20 transition-colors"
            >
              🎲 {d}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={customDice}
              onChange={(e) => setCustomDice(e.target.value)}
              placeholder="3d8+2"
              className="h-[26px] w-16 rounded bg-white/10 px-1.5 text-xs font-mono text-white/70 outline-none placeholder:text-white/30"
              onKeyDown={(e) => {
                if (e.key === "Enter" && customDice.trim()) {
                  handleDiceRoll(customDice.trim());
                  setCustomDice("");
                }
              }}
            />
            <button
              onClick={() => {
                if (customDice.trim()) {
                  handleDiceRoll(customDice.trim());
                  setCustomDice("");
                }
              }}
              className="flex h-[26px] items-center rounded bg-white/10 px-1.5 text-white/70 hover:bg-white/20"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-4 py-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-lg bg-[var(--secondary)] px-2 py-1 text-[0.625rem] ring-1 ring-[var(--border)]"
            >
              {att.type.startsWith("image/") && (
                <img src={att.data} alt={att.name} className="h-5 w-5 rounded object-cover" />
              )}
              <span className="max-w-[80px] truncate">{att.name}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingMoveLabel && (
        <div className={cn("flex items-center", inline ? "px-0 pb-1" : "border-b border-[var(--border)] px-4 py-2")}>
          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-[0.6875rem] text-sky-100/90">
            <span className="shrink-0">📍</span>
            <span className="min-w-0 truncate">Destination: {pendingMoveLabel}</span>
            {onClearPendingMove && (
              <button
                onClick={onClearPendingMove}
                className="shrink-0 text-sky-100/60 transition-colors hover:text-sky-100"
                title="Clear destination"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main input */}
      <div ref={inputBarRef} className={cn("relative flex items-center gap-1.5", inline ? "px-0 py-1" : "px-4 py-3")}>
        {/* Left: Address selector + Attach files */}
        <div className="relative shrink-0">
          {addressMenuOpen && (
            <div
              ref={addressMenuRef}
              className="absolute bottom-full left-0 z-20 mb-2 flex min-w-[11rem] flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 p-1.5 shadow-lg backdrop-blur"
            >
              {hasPartyMembers && (
                <button
                  onClick={() => handleAddressModeSelect("party")}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    addressMode === "party"
                      ? "bg-sky-500/15 text-sky-200"
                      : "text-[var(--foreground)]/75 hover:bg-white/5 hover:text-[var(--foreground)]",
                  )}
                >
                  <Users size={14} className="shrink-0" />
                  <span className="flex-1">Talk to Party</span>
                  {addressMode === "party" && <span className="text-[0.625rem] uppercase tracking-wide">On</span>}
                </button>
              )}
              <button
                onClick={() => handleAddressModeSelect("gm")}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                  addressMode === "gm"
                    ? "bg-amber-500/15 text-amber-200"
                    : "text-[var(--foreground)]/75 hover:bg-white/5 hover:text-[var(--foreground)]",
                )}
              >
                <MessageCircle size={14} className="shrink-0" />
                <span className="flex-1">Talk to GM</span>
                {addressMode === "gm" && <span className="text-[0.625rem] uppercase tracking-wide">On</span>}
              </button>
            </div>
          )}
          <button
            ref={addressButtonRef}
            onClick={() => setAddressMenuOpen((open) => !open)}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition-all active:scale-90",
              addressMode === "party"
                ? "text-sky-400 hover:bg-foreground/10"
                : addressMode === "gm"
                  ? "text-amber-300 hover:bg-foreground/10"
                  : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
            )}
            title={
              addressMode === "party"
                ? "Choose who to address (currently Party)"
                : addressMode === "gm"
                  ? "Choose who to address (currently GM)"
                  : "Choose who to address"
            }
            aria-haspopup="menu"
            aria-expanded={addressMenuOpen}
          >
            <MessageSquare size={18} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "shrink-0 rounded-lg p-1.5 transition-all active:scale-90",
            attachments.length
              ? "text-blue-400 hover:bg-foreground/10"
              : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
          )}
          title="Attach files"
        >
          <Paperclip size={18} />
        </button>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            updateText(e.target.value);
            // Auto-grow: reset height then set to scrollHeight
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? "Waiting for the Game Master..."
              : addressMode === "party"
                ? "Say to party..."
                : addressMode === "gm"
                  ? "Say to GM..."
                  : pendingMoveLabel
                    ? "What do you do when you arrive?"
                    : "What do you do?"
          }
          disabled={disabled}
          rows={1}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-normal text-[#c3c2c2] outline-none placeholder:text-foreground/30 disabled:opacity-50"
          style={{ minHeight: 36, maxHeight: 120 }}
        />

        {queuedDice && (
          <div className="flex items-center self-stretch rounded-lg border border-white/15 bg-white/10 px-2 text-xs text-white/70">
            🎲 {queuedDice}
            <button
              onClick={() => setQueuedDice(null)}
              className="ml-1 text-white/40 transition-colors hover:text-white"
              title="Clear queued roll"
            >
              ✕
            </button>
          </div>
        )}

        {/* Right: Dice, Emoji (desktop), Send */}
        <button
          onClick={() => setShowDice(!showDice)}
          className={cn(
            "shrink-0 rounded-lg p-1.5 transition-all active:scale-90",
            showDice
              ? "text-white/80 hover:bg-foreground/10"
              : "text-white/50 hover:bg-foreground/10 hover:text-white/70",
          )}
          title="Roll dice"
        >
          <Dices size={18} />
        </button>

        <div className="relative hidden sm:block">
          <button
            ref={emojiButtonRef}
            onClick={() => setEmojiOpen((v) => !v)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              emojiOpen
                ? "text-foreground bg-foreground/10"
                : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
            )}
            title="Emoji"
          >
            <Smile size={18} />
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
          onClick={handleSend}
          disabled={
            disabled ||
            (!text.trim() && attachments.length === 0 && !(pendingMoveLabel && addressMode === "scene") && !queuedDice)
          }
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-90",
            (text.trim() || attachments.length > 0 || (pendingMoveLabel && addressMode === "scene") || queuedDice) &&
              !disabled
              ? "text-white hover:text-white/80"
              : "text-white/30",
          )}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
