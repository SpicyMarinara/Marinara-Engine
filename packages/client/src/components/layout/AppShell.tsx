// ──────────────────────────────────────────────
// Layout: Main App Shell (Discord-like three-column)
// ──────────────────────────────────────────────
import { ChatSidebar } from "./ChatSidebar";
import { TopBar } from "./TopBar";
import { SpotifyMobileWidget } from "../spotify/SpotifyMiniPlayer";
import { ChatNotificationBubbles } from "../chat/ChatNotificationBubbles";
import {
  RIGHT_PANEL_WIDTH_MAX,
  RIGHT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TRACKER_PANEL_WIDTH_DEFAULT,
  TRACKER_PANEL_WIDTH_MAX,
  TRACKER_PANEL_WIDTH_MIN,
  useUIStore,
} from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { useBackgroundAutonomousPolling } from "../../hooks/use-background-autonomous";
import { useClearAutonomousUnread } from "../../hooks/use-chats";
import { useIdleDetection } from "../../hooks/use-idle-detection";
import { usePageActivity } from "../../hooks/use-page-activity";
import { cn } from "../../lib/utils";
import { parseChatMetadata } from "../../lib/chat-display";
import { motion, AnimatePresence } from "framer-motion";
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

const ChatArea = lazy(() => import("../chat/ChatArea").then((module) => ({ default: module.ChatArea })));
const CharacterEditor = lazy(() =>
  import("../characters/CharacterEditor").then((module) => ({ default: module.CharacterEditor })),
);
const CharacterLibraryView = lazy(() =>
  import("../characters/CharacterLibraryView").then((module) => ({ default: module.CharacterLibraryView })),
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
const GameAssetsBrowserView = lazy(() =>
  import("../game-assets/GameAssetsBrowserView").then((module) => ({ default: module.GameAssetsBrowserView })),
);
const RightPanel = lazy(() => import("./RightPanel").then((module) => ({ default: module.RightPanel })));
const TrackerDataSidebar = lazy(() =>
  import("./TrackerDataSidebar").then((module) => ({ default: module.TrackerDataSidebar })),
);
const OnboardingTutorial = lazy(() =>
  import("../onboarding/OnboardingTutorial").then((module) => ({ default: module.OnboardingTutorial })),
);

function clampWidth(width: number, min: number, max: number) {
  return Math.max(min, Math.min(max, width));
}

const PANEL_RESIZE_STEP = 16;
const PANEL_RESIZE_LARGE_STEP = 48;
const RESIZER_HITBOX = 10;
const TRACKER_PANEL_EDGE_OFFSET = 8;
const TRACKER_PANEL_HUD_GAP = 6;
const TRACKER_PANEL_DESKTOP_MOTION_MS = 260;
const TRACKER_PANEL_DESKTOP_EXIT_MS = 240;
const TRACKER_PANEL_DESKTOP_EASE = [0.16, 1, 0.3, 1] as const;
const TRACKER_PANEL_DESKTOP_EXIT_EASE = [0.4, 0, 1, 1] as const;
const TRACKER_PANEL_TOGGLE_SELECTOR = '[data-tracker-panel-toggle="roleplay-hud"]';
const TRACKER_PANEL_ANCHOR_SELECTOR = '[data-tracker-panel-anchor="roleplay-hud"]';
const TOP_BAR_SELECTOR = '[data-component="TopBar"]';

function MainPaneFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}
/** Mounts children once `open` becomes true, then keeps them mounted so state persists.
 *  `overlay` mode uses framer-motion slide-in and never unmounts. */
function MountOnceWhenOpened({ open, children, overlay }: { open: boolean; children: React.ReactNode; overlay?: boolean }) {
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open && !everOpened) setEverOpened(true);
  }, [open, everOpened]);
  if (!everOpened) return null;
  if (overlay) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={open ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
        transition={{ duration: 0.2 }}
        className={cn("absolute inset-0 flex flex-col overflow-hidden bg-[var(--background)]", open ? "z-20" : "z-10 pointer-events-none")}
      >
        <Suspense fallback={<MainPaneFallback />}>
          {children}
        </Suspense>
      </motion.div>
    );
  }
  return (
    <div className={open ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
      <Suspense fallback={<MainPaneFallback />}>
        {children}
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
  const trackerPanelEnabled = useUIStore((s) => s.trackerPanelEnabled);
  const trackerPanelOpen = useUIStore((s) => s.trackerPanelOpen);
  const trackerPanelSide = useUIStore((s) => s.trackerPanelSide);
  const trackerPanelHideHudWidgets = useUIStore((s) => s.trackerPanelHideHudWidgets);
  const trackerPanelWidth = useUIStore((s) => s.trackerPanelWidth);
  const setTrackerPanelOpen = useUIStore((s) => s.setTrackerPanelOpen);
  const setTrackerPanelWidth = useUIStore((s) => s.setTrackerPanelWidth);
  const [sidebarDragWidth, setSidebarDragWidth] = useState<number | null>(null);
  const [rightPanelDragWidth, setRightPanelDragWidth] = useState<number | null>(null);
  const [trackerPanelDragWidth, setTrackerPanelDragWidth] = useState<number | null>(null);
  const sidebarDragWidthRef = useRef<number | null>(null);
  const rightPanelDragWidthRef = useRef<number | null>(null);
  const trackerPanelDragWidthRef = useRef<number | null>(null);
  const liveSidebarWidth = sidebarDragWidth ?? sidebarWidth;
  const liveRightPanelWidth = rightPanelDragWidth ?? rightPanelWidth;
  const liveTrackerPanelWidth = trackerPanelDragWidth ?? trackerPanelWidth;

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
  const centerCompact = useUIStore((s) => s.centerCompact);
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
  const characterLibraryOpen = useUIStore((s) => s.characterLibraryOpen);
  const lorebookDetailId = useUIStore((s) => s.lorebookDetailId);
  const presetDetailId = useUIStore((s) => s.presetDetailId);
  const connectionDetailId = useUIStore((s) => s.connectionDetailId);
  const agentDetailId = useUIStore((s) => s.agentDetailId);
  const toolDetailId = useUIStore((s) => s.toolDetailId);
  const personaDetailId = useUIStore((s) => s.personaDetailId);
  const regexDetailId = useUIStore((s) => s.regexDetailId);
  const botBrowserOpen = useUIStore((s) => s.botBrowserOpen);
  const gameAssetsBrowserOpen = useUIStore((s) => s.gameAssetsBrowserOpen);
  const hasCompletedOnboarding = useUIStore((s) => s.hasCompletedOnboarding);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const activeChat = useChatStore((s) => s.activeChat);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const { mutate: clearAutonomousUnread, isPending: isClearingAutonomousUnread } = useClearAutonomousUnread();
  const isPageActive = usePageActivity();
  const [trackerPanelTop, setTrackerPanelTop] = useState(TRACKER_PANEL_EDGE_OFFSET);
  const [trackerPanelExitLayoutHold, setTrackerPanelExitLayoutHold] = useState(false);
  const [trackerPanelToggleAnchorY, setTrackerPanelToggleAnchorY] = useState<number | null>(null);
  const trackerPanelWasActiveRef = useRef(false);
  const lastAutonomousUnreadClearRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeChatId || isClearingAutonomousUnread) return;
    const metadata = parseChatMetadata(activeChat?.metadata);
    const unreadCount = typeof metadata.autonomousUnreadCount === "number" ? metadata.autonomousUnreadCount : 0;
    const persistedUnread = unreadCount > 0;
    if (!persistedUnread && !useChatStore.getState().unreadCounts.has(activeChatId)) return;
    const clearKey = `${activeChatId}:${unreadCount}:${metadata.autonomousUnreadAt ?? ""}`;
    if (lastAutonomousUnreadClearRef.current === clearKey) return;
    clearUnread(activeChatId);
    clearAutonomousUnread(activeChatId, {
      onSuccess: () => {
        lastAutonomousUnreadClearRef.current = clearKey;
      },
    });
  }, [
    activeChat?.metadata,
    activeChatId,
    clearAutonomousUnread,
    clearUnread,
    isClearingAutonomousUnread,
  ]);

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      sidebarDragWidthRef.current = sidebarWidth;
      setSidebarDragWidth(sidebarWidth);

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampWidth(moveEvent.clientX, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX);
        sidebarDragWidthRef.current = nextWidth;
        setSidebarDragWidth(nextWidth);
      };
      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        setSidebarWidth(sidebarDragWidthRef.current ?? useUIStore.getState().sidebarWidth);
        sidebarDragWidthRef.current = null;
        setSidebarDragWidth(null);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [isMobile, setSidebarWidth, sidebarWidth],
  );

  const startRightPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      rightPanelDragWidthRef.current = rightPanelWidth;
      setRightPanelDragWidth(rightPanelWidth);

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampWidth(
          window.innerWidth - moveEvent.clientX,
          RIGHT_PANEL_WIDTH_MIN,
          RIGHT_PANEL_WIDTH_MAX,
        );
        rightPanelDragWidthRef.current = nextWidth;
        setRightPanelDragWidth(nextWidth);
      };
      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        setRightPanelWidth(rightPanelDragWidthRef.current ?? useUIStore.getState().rightPanelWidth);
        rightPanelDragWidthRef.current = null;
        setRightPanelDragWidth(null);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [isMobile, rightPanelWidth, setRightPanelWidth],
  );

  const startTrackerPanelResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      event.preventDefault();
      const originalCursor = document.body.style.cursor;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      trackerPanelDragWidthRef.current = trackerPanelWidth;
      setTrackerPanelDragWidth(trackerPanelWidth);

      const outerEdge =
        trackerPanelSide === "left"
          ? sidebarOpen
            ? liveSidebarWidth
            : 0
          : window.innerWidth - (rightPanelOpen ? liveRightPanelWidth : 0);

      const onMove = (moveEvent: MouseEvent) => {
        const rawWidth = trackerPanelSide === "left" ? moveEvent.clientX - outerEdge : outerEdge - moveEvent.clientX;
        const nextWidth = clampWidth(rawWidth, TRACKER_PANEL_WIDTH_MIN, TRACKER_PANEL_WIDTH_MAX);
        trackerPanelDragWidthRef.current = nextWidth;
        setTrackerPanelDragWidth(nextWidth);
      };
      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        setTrackerPanelWidth(trackerPanelDragWidthRef.current ?? useUIStore.getState().trackerPanelWidth);
        trackerPanelDragWidthRef.current = null;
        setTrackerPanelDragWidth(null);
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [
      isMobile,
      liveRightPanelWidth,
      liveSidebarWidth,
      rightPanelOpen,
      setTrackerPanelWidth,
      sidebarOpen,
      trackerPanelSide,
      trackerPanelWidth,
    ],
  );

  const adjustSidebarWidth = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
      let nextWidth = sidebarWidth;

      if (event.key === "ArrowLeft") nextWidth = sidebarWidth - step;
      else if (event.key === "ArrowRight") nextWidth = sidebarWidth + step;
      else if (event.key === "Home") nextWidth = SIDEBAR_WIDTH_MIN;
      else if (event.key === "End") nextWidth = SIDEBAR_WIDTH_MAX;
      else return;

      event.preventDefault();
      setSidebarWidth(clampWidth(nextWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX));
    },
    [setSidebarWidth, sidebarWidth],
  );

  const adjustRightPanelWidth = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
      let nextWidth = rightPanelWidth;

      if (event.key === "ArrowLeft") nextWidth = rightPanelWidth + step;
      else if (event.key === "ArrowRight") nextWidth = rightPanelWidth - step;
      else if (event.key === "Home") nextWidth = RIGHT_PANEL_WIDTH_MIN;
      else if (event.key === "End") nextWidth = RIGHT_PANEL_WIDTH_MAX;
      else return;

      event.preventDefault();
      setRightPanelWidth(clampWidth(nextWidth, RIGHT_PANEL_WIDTH_MIN, RIGHT_PANEL_WIDTH_MAX));
    },
    [rightPanelWidth, setRightPanelWidth],
  );

  const adjustTrackerPanelWidth = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? PANEL_RESIZE_LARGE_STEP : PANEL_RESIZE_STEP;
      let nextWidth: number;

      if (event.key === "ArrowLeft") nextWidth = trackerPanelWidth + (trackerPanelSide === "right" ? step : -step);
      else if (event.key === "ArrowRight")
        nextWidth = trackerPanelWidth + (trackerPanelSide === "right" ? -step : step);
      else if (event.key === "Home") nextWidth = TRACKER_PANEL_WIDTH_MIN;
      else if (event.key === "End") nextWidth = TRACKER_PANEL_WIDTH_MAX;
      else return;

      event.preventDefault();
      setTrackerPanelWidth(clampWidth(nextWidth, TRACKER_PANEL_WIDTH_MIN, TRACKER_PANEL_WIDTH_MAX));
    },
    [setTrackerPanelWidth, trackerPanelSide, trackerPanelWidth],
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
  ) : characterLibraryOpen ? (
    <CharacterLibraryView />
  ) : lorebookDetailId ? (
    <LorebookEditor />
  ) : null;

  const showAmbientDecor = isPageActive && !activeChatId && !detailView && !botBrowserOpen && !gameAssetsBrowserOpen;
  const hasDetailView = detailView != null;
  const trackerPanelActive = trackerPanelEnabled && trackerPanelOpen;
  const trackerPanelSurfaceAvailable = !botBrowserOpen && !gameAssetsBrowserOpen && !hasDetailView;
  const trackerPanelVisible = trackerPanelActive && trackerPanelSurfaceAvailable;
  useEffect(() => {
    if (trackerPanelVisible) {
      trackerPanelWasActiveRef.current = true;
      setTrackerPanelExitLayoutHold(false);
      return;
    }
    if (!trackerPanelWasActiveRef.current) return;

    trackerPanelWasActiveRef.current = false;
    setTrackerPanelExitLayoutHold(true);
    const timeout = window.setTimeout(() => setTrackerPanelExitLayoutHold(false), TRACKER_PANEL_DESKTOP_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [trackerPanelVisible]);

  const trackerPanelPendingExit = !trackerPanelVisible && trackerPanelWasActiveRef.current;
  const trackerPanelAnchoredForMotion = trackerPanelVisible || trackerPanelExitLayoutHold || trackerPanelPendingExit;
  const trackerPanelDockToEdge = trackerPanelAnchoredForMotion && trackerPanelHideHudWidgets;
  const updateTrackerPanelToggleAnchor = useCallback(() => {
    const root = mainRef.current;
    const toggle =
      root?.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR) ??
      document.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR);
    if (!toggle) return;
    const rect = toggle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || window.getComputedStyle(toggle).display === "none") return;

    const nextCenterY = rect.top + rect.height / 2;
    setTrackerPanelToggleAnchorY((current) =>
      current !== null && Math.abs(current - nextCenterY) < 0.5 ? current : nextCenterY,
    );
  }, []);
  const updateTrackerPanelTop = useCallback(() => {
    const root = mainRef.current;
    if (trackerPanelDockToEdge) {
      const topBar =
        root?.querySelector<HTMLElement>(TOP_BAR_SELECTOR) ?? document.querySelector<HTMLElement>(TOP_BAR_SELECTOR);
      const rect = topBar?.getBoundingClientRect();
      const nextTop =
        rect && rect.height > 0
          ? Math.max(TRACKER_PANEL_EDGE_OFFSET, Math.ceil(rect.bottom))
          : TRACKER_PANEL_EDGE_OFFSET;
      setTrackerPanelTop((current) => (current === nextTop ? current : nextTop));
      return;
    }
    const anchors = Array.from((root ?? document).querySelectorAll<HTMLElement>(TRACKER_PANEL_ANCHOR_SELECTOR));
    const visibleAnchor = anchors.find((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(anchor).display !== "none";
    });
    const nextTop = visibleAnchor
      ? Math.max(
          TRACKER_PANEL_EDGE_OFFSET,
          Math.ceil(visibleAnchor.getBoundingClientRect().bottom + TRACKER_PANEL_HUD_GAP),
        )
      : TRACKER_PANEL_EDGE_OFFSET;
    setTrackerPanelTop((current) => (current === nextTop ? current : nextTop));
  }, [trackerPanelDockToEdge]);

  useLayoutEffect(() => {
    if (isMobile || trackerPanelVisible || !trackerPanelSurfaceAvailable) return;

    let frame = 0;
    let discoveryObserver: MutationObserver | null = null;
    let observedToggle: HTMLElement | null = null;
    const observer = new ResizeObserver(() => scheduleUpdate());
    const observeToggle = () => {
      const root = mainRef.current;
      const toggle =
        root?.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR) ??
        document.querySelector<HTMLElement>(TRACKER_PANEL_TOGGLE_SELECTOR);
      if (!toggle) return false;
      if (observedToggle !== toggle) {
        if (observedToggle) observer.unobserve(observedToggle);
        observer.observe(toggle);
        observedToggle = toggle;
      }
      return true;
    };
    function scheduleUpdate() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const foundToggle = observeToggle();
        updateTrackerPanelToggleAnchor();
        if (foundToggle) {
          discoveryObserver?.disconnect();
          discoveryObserver = null;
        }
      });
    }

    scheduleUpdate();
    if (mainRef.current) {
      discoveryObserver = new MutationObserver(() => scheduleUpdate());
      discoveryObserver.observe(mainRef.current, { childList: true, subtree: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      discoveryObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    activeChat?.mode,
    activeChatId,
    botBrowserOpen,
    gameAssetsBrowserOpen,
    centerCompact,
    isMobile,
    trackerPanelSurfaceAvailable,
    trackerPanelVisible,
    updateTrackerPanelToggleAnchor,
  ]);

  useLayoutEffect(() => {
    if (isMobile || !trackerPanelAnchoredForMotion || !trackerPanelSurfaceAvailable) {
      setTrackerPanelTop(TRACKER_PANEL_EDGE_OFFSET);
      return;
    }

    let frame = 0;
    let discoveryObserver: MutationObserver | null = null;
    const observedTargets = new Set<HTMLElement>();
    const observer = new ResizeObserver(() => {
      scheduleUpdate();
    });
    const observeTargets = () => {
      const selector = trackerPanelDockToEdge ? TOP_BAR_SELECTOR : TRACKER_PANEL_ANCHOR_SELECTOR;
      const targets = Array.from((mainRef.current ?? document).querySelectorAll<HTMLElement>(selector));
      targets.forEach((target) => {
        if (observedTargets.has(target)) return;
        observer.observe(target);
        observedTargets.add(target);
      });
      return targets.length > 0;
    };
    function scheduleUpdate() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const foundTargets = observeTargets();
        updateTrackerPanelTop();
        if (foundTargets) {
          discoveryObserver?.disconnect();
          discoveryObserver = null;
        }
      });
    }

    scheduleUpdate();
    if (mainRef.current) {
      discoveryObserver = new MutationObserver(() => scheduleUpdate());
      discoveryObserver.observe(mainRef.current, { childList: true, subtree: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      discoveryObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    activeChat?.mode,
    activeChatId,
    botBrowserOpen,
    gameAssetsBrowserOpen,
    centerCompact,
    isMobile,
    trackerPanelAnchoredForMotion,
    trackerPanelDockToEdge,
    trackerPanelSurfaceAvailable,
    updateTrackerPanelTop,
  ]);

  const trackerPanelChatAvoidance =
    !isMobile && trackerPanelAnchoredForMotion && trackerPanelSurfaceAvailable
      ? Math.round(liveTrackerPanelWidth * 0.62)
      : 0;
  const trackerPanelHudClearance =
    !isMobile && trackerPanelAnchoredForMotion && trackerPanelHideHudWidgets && trackerPanelSurfaceAvailable
      ? liveTrackerPanelWidth + TRACKER_PANEL_HUD_GAP
      : 0;

  const trackerPanelDesktop = (side: "left" | "right") =>
    trackerPanelVisible && trackerPanelSide === side ? (
      <motion.aside
        key={`tracker-${side}`}
        initial={{
          x: side === "left" ? -22 : 22,
          y: Math.max(-18, Math.min(10, ((trackerPanelToggleAnchorY ?? trackerPanelTop) - trackerPanelTop) * 0.25)),
          scaleX: 0.86,
          scaleY: 0.12,
          opacity: 0,
        }}
        animate={{
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          transition: { duration: TRACKER_PANEL_DESKTOP_MOTION_MS / 1000, ease: TRACKER_PANEL_DESKTOP_EASE },
        }}
        exit={{
          x: side === "left" ? -14 : 14,
          y: Math.max(-16, Math.min(8, ((trackerPanelToggleAnchorY ?? trackerPanelTop) - trackerPanelTop) * 0.2)),
          scaleX: 0.9,
          scaleY: 0.14,
          opacity: 0,
          transition: {
            duration: TRACKER_PANEL_DESKTOP_EXIT_MS / 1000,
            ease: TRACKER_PANEL_DESKTOP_EXIT_EASE,
            opacity: { duration: 0.08, delay: TRACKER_PANEL_DESKTOP_EXIT_MS / 1000 - 0.08, ease: "linear" },
          },
        }}
        data-component={`TrackerDataSidebarDesktop.${side}`}
        aria-label="Tracker data panel"
        className={cn(
          "mari-tracker-panel fixed z-30 hidden overflow-hidden bg-[var(--background)]/20 shadow-2xl ring-1 ring-[var(--border)]/35 backdrop-blur-2xl will-change-[transform,opacity] md:block",
          trackerPanelDragWidth == null && "transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          side === "left" ? "rounded-r-xl" : "rounded-l-xl",
        )}
        style={{
          top: trackerPanelTop,
          maxHeight: `calc(100vh - ${trackerPanelTop + TRACKER_PANEL_EDGE_OFFSET}px)`,
          width: liveTrackerPanelWidth,
          transformOrigin: `${side === "left" ? "left" : "right"} ${Math.max(
            -56,
            Math.min(56, (trackerPanelToggleAnchorY ?? trackerPanelTop) - trackerPanelTop),
          )}px`,
          ...(side === "left"
            ? { left: sidebarOpen ? liveSidebarWidth + RESIZER_HITBOX : 0 }
            : { right: rightPanelOpen ? liveRightPanelWidth + RESIZER_HITBOX : 0 }),
        }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tracker panel"
          aria-valuemin={TRACKER_PANEL_WIDTH_MIN}
          aria-valuemax={TRACKER_PANEL_WIDTH_MAX}
          aria-valuenow={Math.round(liveTrackerPanelWidth)}
          tabIndex={0}
          onMouseDown={startTrackerPanelResize}
          onDoubleClick={() => setTrackerPanelWidth(TRACKER_PANEL_WIDTH_DEFAULT)}
          onKeyDown={adjustTrackerPanelWidth}
          className={cn(
            "mari-resize-x group/resize absolute inset-y-0 z-20 hidden w-2 touch-none select-none bg-transparent focus-visible:outline-none md:block",
            side === "left" ? "right-0" : "left-0",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-y-1.5 w-px rounded-full bg-[var(--primary)]/0 transition-colors group-hover/resize:bg-[var(--primary)]/24 group-focus-visible/resize:bg-[var(--primary)]/42",
              side === "left" ? "right-0" : "left-0",
            )}
          />
        </div>
        <div className="mari-tracker-panel-scroll max-h-[inherit] overflow-x-hidden overflow-y-auto">
          <Suspense fallback={<SidePanelFallback />}>
            <TrackerDataSidebar />
          </Suspense>
        </div>
      </motion.aside>
    ) : null;

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
          "mari-sidebar flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl",
          sidebarDragWidth == null && "transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          sidebarOpen && "border-r border-[var(--sidebar-border)]/30",
          // Mobile: fixed overlay
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl max-md:pt-[env(safe-area-inset-top)]",
          !sidebarOpen && "max-md:!w-0",
        )}
        style={{ width: sidebarOpen ? (isMobile ? "100vw" : liveSidebarWidth) : 0 }}
      >
        <div className="h-full" style={{ width: isMobile ? "100vw" : liveSidebarWidth }}>
          <ChatSidebar />
        </div>
      </aside>
      {!isMobile && sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-valuenow={Math.round(liveSidebarWidth)}
          tabIndex={0}
          onMouseDown={startSidebarResize}
          onKeyDown={adjustSidebarWidth}
          className="absolute inset-y-0 z-20 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 focus-visible:bg-[var(--primary)]/40 focus-visible:outline-none md:block"
          style={{ left: sidebarOpen ? liveSidebarWidth : 0 }}
        />
      )}

      <AnimatePresence initial={false}>{!isMobile && trackerPanelSurfaceAvailable && trackerPanelDesktop("left")}</AnimatePresence>

      {/* Center content */}
      <main
        ref={mainRef}
        data-tour="chat-area"
        data-component="CenterContent"
        aria-label="Main content"
        className="@container mari-main relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <TopBar />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* Bot Browser — kept mounted once opened so state persists across close/reopen */}
          <MountOnceWhenOpened open={botBrowserOpen} overlay>
            <BotBrowserView />
          </MountOnceWhenOpened>
          {/* Game Assets Browser — kept mounted once opened so state persists across close/reopen */}
          <MountOnceWhenOpened open={gameAssetsBrowserOpen} overlay>
            <GameAssetsBrowserView />
          </MountOnceWhenOpened>
          <div
            className={botBrowserOpen || gameAssetsBrowserOpen ? "hidden" : "flex flex-1 flex-col overflow-hidden"}
            style={
              {
                "--tracker-chat-avoid-left": `${trackerPanelSide === "left" ? trackerPanelChatAvoidance : 0}px`,
                "--tracker-chat-avoid-right": `${trackerPanelSide === "right" ? trackerPanelChatAvoidance : 0}px`,
                "--tracker-panel-hud-clear-left": `${trackerPanelSide === "left" ? trackerPanelHudClearance : 0}px`,
                "--tracker-panel-hud-clear-right": `${trackerPanelSide === "right" ? trackerPanelHudClearance : 0}px`,
              } as CSSProperties
            }
          >
            <Suspense fallback={<MainPaneFallback />}>{detailView ?? <ChatArea />}</Suspense>
          </div>
        </div>
        {/* Floating avatar notification bubbles (right edge) */}
        <ChatNotificationBubbles />
      </main>

      <AnimatePresence initial={false}>{!isMobile && trackerPanelSurfaceAvailable && trackerPanelDesktop("right")}</AnimatePresence>

      {/* Mobile tracker panel backdrop */}
      {trackerPanelVisible && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setTrackerPanelOpen(false)}
        />
      )}

      {/* Mobile tracker panel */}
      {isMobile && (
        <AnimatePresence mode="wait">
          {trackerPanelVisible && (
            <motion.aside
              key="mobile-tracker"
              initial={{ x: trackerPanelSide === "left" ? "-100%" : "100%" }}
              animate={{ x: 0 }}
              exit={{ x: trackerPanelSide === "left" ? "-100%" : "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 350 }}
              data-component="TrackerDataSidebarMobile"
              aria-label="Tracker data panel"
              className={cn(
                "mari-tracker-panel !fixed inset-y-0 z-50 w-[calc(100vw-0.5rem)] max-w-[24rem] overflow-hidden bg-[var(--background)]/65 pt-[env(safe-area-inset-top)] shadow-2xl backdrop-blur-xl",
                trackerPanelSide === "left" ? "left-0" : "right-0",
              )}
            >
              <Suspense fallback={<SidePanelFallback />}>
                <TrackerDataSidebar fillHeight />
              </Suspense>
            </motion.aside>
          )}
        </AnimatePresence>
      )}

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
            "mari-right-panel flex-shrink-0 overflow-hidden bg-[var(--background)]/80 backdrop-blur-xl",
            rightPanelDragWidth == null && "transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            rightPanelOpen && "border-l border-[var(--sidebar-border)]/30",
          )}
          style={{ width: rightPanelOpen ? liveRightPanelWidth : 0 }}
        >
          {rightPanelOpen && (
            <div className="h-full" style={{ width: liveRightPanelWidth }}>
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
          aria-valuemin={RIGHT_PANEL_WIDTH_MIN}
          aria-valuemax={RIGHT_PANEL_WIDTH_MAX}
          aria-valuenow={Math.round(liveRightPanelWidth)}
          tabIndex={0}
          onMouseDown={startRightPanelResize}
          onKeyDown={adjustRightPanelWidth}
          className="absolute inset-y-0 z-20 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--primary)]/30 focus-visible:bg-[var(--primary)]/40 focus-visible:outline-none md:block"
          style={{ right: rightPanelOpen ? liveRightPanelWidth : 0 }}
        />
      )}

      {/* First-time onboarding tutorial */}
      {!hasCompletedOnboarding && (
        <Suspense fallback={null}>
          <OnboardingTutorial />
        </Suspense>
      )}
      <SpotifyMobileWidget />
    </div>
  );
}
