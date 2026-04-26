// ──────────────────────────────────────────────
// Chat: Mari Thinking Indicator
// ──────────────────────────────────────────────
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PROFESSOR_MARI_ID } from "@marinara-engine/shared";
import { useChatStore } from "../../stores/chat.store";
import { useChat } from "../../hooks/use-chats";

/** Minimum visible duration so fast phases (single DB write) still register. */
const MIN_VISIBLE_MS = 600;

type MariPhase = "thinking" | "updating" | "idle";

const PHASE_LABEL: Record<Exclude<MariPhase, "idle">, string> = {
  thinking: "Mari is thinking…",
  updating: "Mari is updating your stuff…",
};

/**
 * Visible-while-working signal for Mari's two work phases:
 *
 * 1. `thinking` — Mari is generating her reply (token streaming has begun).
 * 2. `updating` — Mari is running embedded commands (create_character,
 *    update_character, fetch, …) in the post-stream loop.
 *
 * Without this pill the UI is otherwise silent during those phases, so a
 * user who asked her to do something can't tell whether she's still working
 * or stalled.
 *
 * Transport: window CustomEvents `marinara:mari-phase` dispatched by
 * use-generate.ts. We previously tried a Zustand subscribeWithSelector
 * subscription; in this codebase that combination has documented timing
 * issues with React 19 batching that drop fast transitions (see
 * GameSurface.tsx for the same workaround). CustomEvents fire synchronously
 * and outside React's batching, so the indicator reliably observes every
 * phase change.
 *
 * A minimum visible duration keeps each phase on-screen long enough to
 * perceive even when it finishes in under a millisecond.
 */
function isMariParticipant(activeChat: unknown): boolean {
  // characterIds arrives as an array (typed) or a JSON-encoded string
  // (raw SQLite column) depending on the endpoint that produced it.
  const raw = (activeChat as { characterIds?: unknown } | null | undefined)?.characterIds;
  if (Array.isArray(raw)) return raw.includes(PROFESSOR_MARI_ID);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.includes(PROFESSOR_MARI_ID);
    } catch {
      return false;
    }
  }
  return false;
}

export const MariThinkingIndicator = memo(function MariThinkingIndicator() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: activeChat } = useChat(activeChatId);
  const isMariChat = useMemo(() => isMariParticipant(activeChat), [activeChat]);

  const [phase, setPhase] = useState<MariPhase>("idle");
  const phaseShownAtRef = useRef(0);
  const visibleChatIdRef = useRef<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const isMariChatRef = useRef(isMariChat);
  isMariChatRef.current = isMariChat;

  // Hide immediately when the user leaves a Mari chat — the pill belongs to
  // the previous chat and shouldn't linger into a chat that doesn't even
  // qualify for the indicator.
  useEffect(() => {
    if (isMariChat) return;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    visibleChatIdRef.current = null;
    setPhase("idle");
  }, [isMariChat]);

  // If the active chat changes while the pill is showing for a different
  // chat, hide it immediately — don't let the min-duration timer leak the
  // pill into an unrelated chat.
  useEffect(() => {
    if (visibleChatIdRef.current && visibleChatIdRef.current !== activeChatId) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      visibleChatIdRef.current = null;
      setPhase("idle");
    }
  }, [activeChatId]);

  useEffect(() => {
    const onPhase = (e: Event) => {
      const detail = (e as CustomEvent<{ chatId?: string; phase?: MariPhase }>).detail;
      const chatId = detail?.chatId;
      const nextPhase = detail?.phase;
      if (!chatId || !nextPhase) return;

      // Idle event from a chat we don't own — nothing to hide here.
      if (nextPhase === "idle" && visibleChatIdRef.current !== chatId) return;

      if (nextPhase === "idle") {
        if (hideTimerRef.current) return;
        const elapsed = Date.now() - phaseShownAtRef.current;
        const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          visibleChatIdRef.current = null;
          setPhase("idle");
        }, remaining);
        return;
      }

      // thinking / updating — only show in the chat the user is looking at,
      // and only if Mari is a participant.
      if (!isMariChatRef.current) return;
      if (chatId !== activeChatIdRef.current) return;

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      phaseShownAtRef.current = Date.now();
      visibleChatIdRef.current = chatId;
      setPhase(nextPhase);
    };

    window.addEventListener("marinara:mari-phase", onPhase);
    return () => {
      window.removeEventListener("marinara:mari-phase", onPhase);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-2 flex items-center gap-2 rounded-lg bg-foreground/5 px-3 py-1.5 text-xs text-foreground/60"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse [animation-delay:400ms]" />
      </span>
      <span>{PHASE_LABEL[phase]}</span>
    </div>
  );
});
