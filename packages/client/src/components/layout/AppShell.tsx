// ──────────────────────────────────────────────
// Layout: Main App Shell (Discord-like three-column)
// ──────────────────────────────────────────────
import { ChatSidebar } from "./ChatSidebar";
import { TopBar } from "./TopBar";
import { ChatNotificationBubbles } from "../chat/ChatNotificationBubbles";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { useBackgroundAutonomousPolling } from "../../hooks/use-background-autonomous";
import { useIdleDetection } from "../../hooks/use-idle-detection";
import { usePageActivity } from "../../hooks/use-page-activity";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { lazy, Suspense, useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from "react";

const ChatArea = lazy(() => import("../chat/ChatArea").then((module) => ({ default: module.ChatArea })));
const CharacterEditor = lazy(() =>
  import("../characters/CharacterEditor").then((module) => ({ default: module.CharacterEditor })),
);
const LorebookEditor = lazy(() =>
  import("../lorebooks/LorebookEditor").then((module) => ({ default: module.LorebookEditor })),
);
const PresetEditor = lazy(() => import("../presets/PresetEditor").then((module) => ({ default: module.PresetEditor })));
const ConnectionEditor = lazy(() =>
  import("../connections/ConnectionEditor").then((module) => ({ default: module.ConnectionEditor })),
);
const AgentEditor = lazy(() => import("../agents/AgentEditor").then((module) => ({ default: module.AgentEditor })));
const ToolEditor = lazy(() => import("../agents/ToolEditor").then((module) => ({ default: module.ToolEditor })));
const PersonaEditor = lazy(() =>
  import("../personas/PersonaEditor").then((module) => ({ default: module.PersonaEditor })),
);
const RegexScriptEditor = lazy(() =>
  import("../agents/RegexScriptEditor").then((module) => ({ default: module.RegexScriptEditor })),
);
const BotBrowserView = lazy(() =>
  import("../bot-browser/BotBrowserView").then((module) => ({ default: module.BotBrowserView })),
);
const RightPanel = lazy(() => import("./RightPanel").then((module) => ({ default: module.RightPanel })));
const OnboardingTutorial = lazy(() =>
  import("../onboarding/OnboardingTutorial").then((module) => ({ default: module.OnboardingTutorial })),
);

function MainPaneFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}
/** Keeps BotBrowserView mounted (hidden via CSS) once it's been opened at least once, so state persists. */
function BotBrowserPersistent({ open }: { open: boolean }) {
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open && !everOpened) setEverOpened(true);
  }, [open, everOpened]);
  if (!everOpened) return null;
  return (
    <div className={open ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
      <Suspense fallback={<MainPaneFallback />}>
        <BotBrowserView />
      </Suspense>
    </div>
  );
}

function SidePanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}

export function AppShell() {
  // Background autonomous polling for inactive conversation chats
  useBackgroundAutonomousPolling();

  // Auto idle detection (10 min inactivity → idle, activity → active)
  useIdleDetection();

  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const closeRightPanel = useUIStore((s) => s.closeRightPanel);

  // Track mobile breakpoint for right-panel animation strategy
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Auto-close right panel when viewport is too narrow for comfort
  useEffect(() => {
    if (isMobile) return; // Mobile uses overlays, no squishing concern
    let rafId = 0;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { rightPanelOpen: rp, sidebarOpen: sb, sidebarWidth: sw, closeRightPanel: close } = useUIStore.getState();
        if (!rp) return;
        const panelWidth = useUIStore.getState().rightPanelWidth;
        const reserved = (sb ? sw : 0) + panelWidth;
        if (window.innerWidth - reserved < 400) close();
      });
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafId);
    };
  }, [isMobile]);

  // ── Center-area overflow detection ──
  // When the center <main> content overflows horizontally, switch to compact
  // layout. Uses hysteresis to prevent toggling back-and-forth.
  const mainRef = useRef<HTMLElement>(null);
  const compactWidthRef = useRef(0); // width when we last switched to compact
  const setCenterCompact = useUIStore((s) => s.setCenterCompact);

  const checkOverflow = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const compact = useUIStore.getState().centerCompact;
    const width = el.clientWidth;

    if (compact) {
      if (width > compactWidthRef.current + 80) {
        setCenterCompact(false);
      }
    } else {
      let overflows = false;
      const scan = (node: Element, depth: number) => {
        if (overflows || depth > 3) return;
        if (node.scrollWidth > node.clientWidth + 2) {
          overflows = true;
          return;
        }
        for (let i = 0; i < node.children.length; i++) {
          scan(node.children[i]!, depth + 1);
        }
      };
      scan(el, 0);
      if (overflows) {
        compactWidthRef.current = width;
        setCenterCompact(true);
      }
    }
  }, [setCenterCompact]);

  // Debounce the overflow check so ResizeObserver doesn't cause layout thrashing
  const overflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCheckOverflow = useCallback(() => {
    if (overflowTimerRef.current) clearTimeout(overflowTimerRef.current);
    overflowTimerRef.current = setTimeout(checkOverflow, 100);
  }, [checkOverflow]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(debouncedCheckOverflow);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (overflowTimerRef.current) clearTimeout(overflowTimerRef.current);
    };
  }, [debouncedCheckOverflow]);

  const characterDetailId = useUIStore((s) => s.characterDetailId);
  const lorebookDetailId = useUIStore((s) => s.lorebookDetailId);
  const presetDetailId = useUIStore((s) => s.presetDetailId);
  const connectionDetailId = useUIStore((s) => s.connectionDetailId);
  const agentDetailId = useUIStore((s) => s.agentDetailId);
  const toolDetailId = useUIStore((s) => s.toolDetailId);
  const personaDetailId = useUIStore((s) => s.personaDetailId);
  const regexDetailId = useUIStore((s) => s.regexDetailId);
  const botBrowserOpen = useUIStore((s) => s.botBrowserOpen);
  const hasCompletedOnboarding = useUIStore((s) => s.hasCompletedOnboarding);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isPageActive = usePageActivity();

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        setSidebarWidth(moveEvent.clientX);
      };
      const onUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isMobile, setSidebarWidth],
  );

  const startRightPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        setRightPanelWidth(window.innerWidth - moveEvent.clientX);
      };
      const onUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isMobile, setRightPanelWidth],
  );

  const detailView = regexDetailId ? (
    <RegexScriptEditor />
  ) : personaDetailId ? (
    <PersonaEditor />
  ) : toolDetailId ? (
    <ToolEditor />
  ) : agentDetailId ? (
    <AgentEditor />
  ) : connectionDetailId ? (
    <ConnectionEditor />
  ) : presetDetailId ? (
    <PresetEditor />
  ) : characterDetailId ? (
    <CharacterEditor />
  ) : lorebookDetailId ? (
    <LorebookEditor />
  ) : null;

  const showAmbientDecor = isPageActive && !activeChatId && !detailView && !botBrowserOpen;

  return (
    <div
      data-component="AppShell"
      className={cn(
        "mari-app fixed inset-0 flex overflow-hidden bg-[var(--background)] max-md:pt-[env(safe-area-inset-top)]",
        showAmbientDecor && "retro-scanlines noise-bg geometric-grid",
      )}
    >
      {/* Y2K decorative stars */}
      {showAmbientDecor && (
        <>
          <div className="y2k-star hidden md:block" style={{ top: "10%", left: "5%", animationDelay: "0s" }} />
          <div className="y2k-star-md hidden md:block" style={{ top: "25%", right: "8%", animationDelay: "1.5s" }} />
          <div className="y2k-star-lg hidden md:block" style={{ top: "60%", left: "3%", animationDelay: "3s" }} />
          <div className="y2k-star hidden md:block" style={{ top: "80%", right: "12%", animationDelay: "0.8s" }} />
          <div className="y2k-star-md hidden md:block" style={{ top: "45%", left: "50%", animationDelay: "2.2s" }} />
        </>
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left sidebar - Chat list */}
      <aside
        data-tour="sidebar"
        data-component="ChatSidebarPanel"
        aria-label="Chat list"
        className={cn(
          "mari-sidebar flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          sidebarOpen && "border-r border-[var(--sidebar-border)]/30",
          // Mobile: fixed overlay
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl max-md:pt-[env(safe-area-inset-top)]",
          !sidebarOpen && "max-md:!w-0",
        )}
        style={{ width: sidebarOpen ? (isMobile ? "100vw" : sidebarWidth) : 0 }}
      >
        <div className="h-full" style={{ width: isMobile ? "100vw" : sidebarWidth }}>
          <ChatSidebar />
        </div>
      </aside>
      {!isMobile && sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
          onMouseDown={startSidebarResize}
          className="relative z-20 hidden w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 md:block"
        />
      )}

      {/* Center content */}
      <main
        ref={mainRef}
        data-tour="chat-area"
        data-component="CenterContent"
        aria-label="Main content"
        className="@container mari-main relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <TopBar />
        {/* Bot Browser — kept mounted once opened so state persists across close/reopen */}
        <BotBrowserPersistent open={botBrowserOpen} />
        <div className={botBrowserOpen ? "hidden" : "flex flex-1 flex-col overflow-hidden"}>
          <Suspense fallback={<MainPaneFallback />}>{detailView ?? <ChatArea />}</Suspense>
        </div>
        {/* Floating avatar notification bubbles (right edge) */}
        <ChatNotificationBubbles />
      </main>

      {/* Mobile right panel backdrop */}
      {rightPanelOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => closeRightPanel()} />
      )}

      {/* Right panel - Context / Settings */}
      {isMobile ? (
        <AnimatePresence mode="wait">
          {rightPanelOpen && (
            <motion.aside
              key="mobile"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 350 }}
              data-component="RightPanelMobile"
              aria-label="Settings and tools panel"
              className="mari-right-panel !fixed inset-y-0 right-0 z-50 !w-full shadow-2xl overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]"
            >
              <Suspense fallback={<SidePanelFallback />}>
                <RightPanel />
              </Suspense>
            </motion.aside>
          )}
        </AnimatePresence>
      ) : (
        <aside
          data-component="RightPanelDesktop"
          aria-label="Settings and tools panel"
          className={cn(
            "mari-right-panel flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
            rightPanelOpen && "border-l border-[var(--sidebar-border)]/30",
          )}
          style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
        >
          {rightPanelOpen && (
            <div className="h-full" style={{ width: rightPanelWidth }}>
              <Suspense fallback={<SidePanelFallback />}>
                <RightPanel />
              </Suspense>
            </div>
          )}
        </aside>
      )}
      {!isMobile && rightPanelOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right sidebar"
          onMouseDown={startRightPanelResize}
          className="absolute inset-y-0 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 md:block"
          style={{ right: rightPanelOpen ? rightPanelWidth : 0 }}
        />
      )}

      {/* First-time onboarding tutorial */}
      {!hasCompletedOnboarding && (
        <Suspense fallback={null}>
          <OnboardingTutorial />
        </Suspense>
      )}
    </div>
  );
}
