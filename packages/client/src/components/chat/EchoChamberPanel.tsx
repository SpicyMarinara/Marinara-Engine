// ──────────────────────────────────────────────
// Echo Chamber Overlay — compact translucent stream-chat widget
// Messages appear one-by-one every 30 s, auto-scrolling.
// Positions itself within the chat area, respecting sidebar, right panel,
// HUD widget position (top/left/right), and the top bar.
// ──────────────────────────────────────────────
import { useRef, useEffect, useMemo, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { useAgentStore } from "../../stores/agent.store";
import { useUIStore } from "../../stores/ui.store";
import type { EchoChamberSide } from "../../stores/ui.store";
import { useAgentConfigs } from "../../hooks/use-agents";
import { useChatStore } from "../../stores/chat.store";
import { useChat } from "../../hooks/use-chats";
import { api } from "../../lib/api-client";
import { cn } from "../../lib/utils";

const MESSAGE_INTERVAL_MS = 30_000; // 30 s between reveals
const NAME_COLORS = [
  "text-red-400",
  "text-blue-400",
  "text-green-400",
  "text-yellow-400",
  "text-purple-400",
  "text-pink-400",
  "text-cyan-400",
  "text-orange-400",
  "text-emerald-400",
  "text-rose-400",
  "text-indigo-400",
  "text-amber-400",
];

const CORNERS: EchoChamberSide[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

// Layout constants (px)
const WIDGET_BAR_H = 76; // top HUD toolbar: py-2 (16px) + widget buttons h-[3.75rem] (60px)
const INPUT_BOX_H = 72; // bottom chat input area height
const GAP = 8; // breathing room

interface EchoChamberPanelProps {
  hiddenOnMobile?: boolean;
}

/** Tiny 4-square grid icon; the active corner is highlighted. */
function CornerPicker({ current, onChange }: { current: EchoChamberSide; onChange: (c: EchoChamberSide) => void }) {
  if (typeof window !== "undefined" && window.innerWidth < 768) return null;
  return (
    <div className="grid grid-cols-2 gap-px">
      {CORNERS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "h-[0.4375rem] w-[0.4375rem] rounded-[0.09375rem] transition-colors",
            c === current ? "bg-purple-400" : "bg-white/15 hover:bg-white/30",
          )}
          title={c.replace("-", " ")}
        />
      ))}
    </div>
  );
}

export function EchoChamberPanel({ hiddenOnMobile = false }: EchoChamberPanelProps) {
  const echoChamberOpen = useUIStore((s) => s.echoChamberOpen);
  const echoChamberSide = useUIStore((s) => s.echoChamberSide);
  const toggleEchoChamber = useUIStore((s) => s.toggleEchoChamber);
  const setEchoChamberSide = useUIStore((s) => s.setEchoChamberSide);
  const echoMessages = useAgentStore((s) => s.echoMessages);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: chat } = useChat(activeChatId);
  const { data: agentConfigs } = useAgentConfigs();

  // Mirror the enabledAgentTypes logic from ChatArea so per-chat overrides are respected
  const echoEnabled = useMemo(() => {
    if (!chat) return false;
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> }).metadata;
    const meta = typeof raw === "string" ? JSON.parse(raw) : ((raw ?? {}) as Record<string, unknown>);
    if (!meta.enableAgents) return false;
    const activeAgentIds: string[] = Array.isArray(meta.activeAgentIds) ? meta.activeAgentIds : [];
    if (activeAgentIds.length > 0) {
      return activeAgentIds.includes("echo-chamber");
    }
    // Fallback: check global agent config
    if (!agentConfigs) return false;
    const cfg = (agentConfigs as Array<{ type: string; enabled: string }>).find((a) => a.type === "echo-chamber");
    return cfg?.enabled === "true";
  }, [chat, agentConfigs]);

  // ── Timed reveal: show one more message every 30 s ──
  // visibleCount and baseline live in the Zustand store so they survive
  // component remounts (e.g. when the panel is toggled or the HUD re-renders).
  const visibleCount = useAgentStore((s) => s.echoVisibleCount);
  const baseline = useAgentStore((s) => s.echoBaseline);
  const setEchoVisibleCount = useAgentStore((s) => s.setEchoVisibleCount);
  const setEchoBaseline = useAgentStore((s) => s.setEchoBaseline);

  // ── Load persisted echo messages when chat changes ──
  const setEchoMessages = useAgentStore((s) => s.setEchoMessages);
  const clearEchoMessages = useAgentStore((s) => s.clearEchoMessages);
  const echoLoadedChatId = useAgentStore((s) => s.echoLoadedChatId);
  const setEchoLoadedChatId = useAgentStore((s) => s.setEchoLoadedChatId);

  useEffect(() => {
    if (!activeChatId || !echoEnabled) return;
    // Already loaded for this chat (survives component remounts)
    if (echoLoadedChatId === activeChatId) return;

    const previousChatId = echoLoadedChatId;
    setEchoLoadedChatId(activeChatId);

    // Only clear + reset when switching to a *different* chat
    if (previousChatId !== null && previousChatId !== activeChatId) {
      clearEchoMessages();
    }

    api
      .get<Array<{ characterName: string; reaction: string; timestamp: number }>>(
        `/agents/echo-messages/${activeChatId}`,
      )
      .then((msgs) => {
        if (useAgentStore.getState().echoLoadedChatId !== activeChatId) return; // stale
        if (msgs.length > 0) {
          // If real-time messages already arrived (via addEchoMessage from SSE),
          // don't overwrite visibleCount — the stagger timer owns it.
          const alreadyHasMessages = useAgentStore.getState().echoMessages.length > 0;
          setEchoMessages(msgs);
          if (!alreadyHasMessages) {
            // Fresh load (page refresh) — show all persisted immediately.
            // Read the actual store length (may be capped) rather than the API
            // response length — a mismatch causes the stagger guard to skip,
            // making new messages dump all at once instead of one-by-one.
            const loaded = useAgentStore.getState().echoMessages.length;
            setEchoVisibleCount(loaded);
            setEchoBaseline(loaded);
          }
        }
      })
      .catch(() => {
        /* silently ignore load failures */
      });
  }, [
    activeChatId,
    echoEnabled,
    echoLoadedChatId,
    setEchoLoadedChatId,
    setEchoMessages,
    clearEchoMessages,
    setEchoVisibleCount,
    setEchoBaseline,
  ]);

  // When new messages arrive beyond the baseline, stagger them one-by-one.
  useEffect(() => {
    if (visibleCount >= echoMessages.length) return;
    // Messages at or below the baseline are already visible
    if (visibleCount < baseline) {
      setEchoVisibleCount(baseline);
      return;
    }
    const id = setTimeout(() => setEchoVisibleCount(visibleCount + 1), MESSAGE_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [visibleCount, echoMessages.length, baseline, setEchoVisibleCount]);

  // Auto-scroll when a new message becomes visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [visibleCount]);

  // Name → color map
  const nameColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of echoMessages) {
      if (!map.has(msg.characterName)) {
        let hash = 0;
        for (let i = 0; i < msg.characterName.length; i++)
          hash = msg.characterName.charCodeAt(i) + ((hash << 5) - hash);
        map.set(msg.characterName, NAME_COLORS[Math.abs(hash) % NAME_COLORS.length]!);
      }
    }
    return map;
  }, [echoMessages]);

  // ── Compute position style relative to the chat area container ──
  const [posStyle, setPosStyle] = useState<Record<string, number | undefined>>({});
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => {
    if (!echoChamberOpen) return;
    // On mobile, position below the HUD bar.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      const findVisibleHud = (): HTMLElement | null => {
        const els = document.querySelectorAll<HTMLElement>(".rpg-hud");
        for (const el of els) {
          if (el.getBoundingClientRect().height > 0) return el;
        }
        return null;
      };

      const update = () => {
        const hudEl = findVisibleHud();
        // Position relative to container, so measure HUD bottom relative to rpg-chat-area
        const container = hudEl?.closest(".rpg-chat-area");
        const containerTop = container?.getBoundingClientRect().top ?? 0;
        const hudBottom = hudEl ? hudEl.getBoundingClientRect().bottom - containerTop : 56;
        setPosStyle({ top: hudBottom + 8, left: 16, right: 16 });
      };

      update();

      const hudEl = findVisibleHud();
      let ro: ResizeObserver | undefined;
      if (hudEl) {
        ro = new ResizeObserver(update);
        ro.observe(hudEl);
      }

      return () => ro?.disconnect();
    }
    // Desktop: position within the chat area container (absolute, not fixed)
    const isTop = echoChamberSide.startsWith("top");
    const isLeft = echoChamberSide.endsWith("left");
    const topOffset = isTop ? WIDGET_BAR_H + GAP : undefined;
    const bottomOffset = !isTop ? INPUT_BOX_H + GAP : undefined;
    const leftOffset = isLeft ? GAP : undefined;
    const rightOffset = !isLeft ? GAP : undefined;
    setPosStyle({
      ...(topOffset !== undefined && { top: topOffset }),
      ...(bottomOffset !== undefined && { bottom: bottomOffset }),
      ...(leftOffset !== undefined && { left: leftOffset }),
      ...(rightOffset !== undefined && { right: rightOffset }),
    });
  }, [echoChamberOpen, echoChamberSide]);

  if (!echoChamberOpen || !echoEnabled || (isMobile && hiddenOnMobile)) return null;
  const visibleMessages = echoMessages.slice(0, visibleCount);

  return (
    <div
      className={cn(
        "absolute z-[60] flex flex-col rounded-xl border border-white/[0.04] shadow-lg",
        "pointer-events-auto w-60 max-md:w-auto max-h-44 max-md:max-h-28",
      )}
      style={{ ...posStyle, background: "rgba(10, 10, 22, 0.35)", backdropFilter: "blur(14px)" }}
    >
      {/* Header — live dot, corner picker, close */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-purple-400/60">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          Echo
          {visibleMessages.length > 0 && (
            <span className="ml-0.5 text-[0.5625rem] font-normal text-white/25">{visibleMessages.length}</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {visibleMessages.length > 0 && (
            <button
              onClick={async () => {
                if (!activeChatId) return;
                clearEchoMessages();
                setEchoVisibleCount(0);
                setEchoBaseline(0);
                try {
                  await api.delete(`/agents/echo-messages/${activeChatId}`);
                } catch {
                  /* best-effort */
                }
              }}
              className="rounded p-0.5 text-white/20 transition-colors hover:bg-white/10 hover:text-white/50"
              title="Clear messages"
            >
              <Trash2 size="0.5625rem" />
            </button>
          )}
          {/* Hide position button on mobile */}
          <span className="hidden md:inline-flex">
            <CornerPicker current={echoChamberSide} onChange={setEchoChamberSide} />
          </span>
          <button
            onClick={toggleEchoChamber}
            className="rounded p-0.5 text-white/20 transition-colors hover:bg-white/10 hover:text-white/50"
          >
            <X size="0.625rem" />
          </button>
        </div>
      </div>

      {/* Scrollable message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 pb-1.5 scrollbar-thin">
        {visibleMessages.length === 0 ? (
          <p className="py-1.5 text-center text-[0.625rem] text-white/25">Waiting for reactions…</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visibleMessages.map((msg, i) => (
              <div key={i} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
                <span className={cn("text-[0.6875rem] font-bold", nameColorMap.get(msg.characterName))}>
                  {msg.characterName}
                </span>
                <span className="text-[0.6875rem] text-white/30">: </span>
                <span className="text-[0.6875rem] leading-snug text-white/60">{msg.reaction}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
