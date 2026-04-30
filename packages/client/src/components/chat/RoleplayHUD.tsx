// ──────────────────────────────────────────────
// Chat: Roleplay HUD — immersive world-state widgets
// Each tracker category gets its own mini widget with
// a compact preview and expandable editable popover.
// Supports top (horizontal) and left/right (vertical) layout.
// ──────────────────────────────────────────────
import { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  MapPin,
  Thermometer,
  Users,
  Package,
  Scroll,
  CalendarDays,
  Trash2,
  Sparkles,
  MessageCircle,
  Swords,
  RefreshCw,
  BarChart3,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { useGameStateStore } from "../../stores/game-state.store";
import { useAgentStore } from "../../stores/agent.store";
import { useAgentConfigs } from "../../hooks/use-agents";
import { useUIStore } from "../../stores/ui.store";
import type {
  GameState,
  PresentCharacter,
  CharacterStat,
  InventoryItem,
  QuestProgress,
  CustomTrackerField,
} from "@marinara-engine/shared";
import type { HudPosition } from "../../stores/ui.store";

interface RoleplayHUDProps {
  chatId: string;
  characterCount: number;
  layout?: HudPosition;
  isStreaming: boolean;
  onRetriggerTrackers?: () => void;
  onRerunSingleTracker?: (agentType: string) => void;
  onRetryFailedAgents?: () => void;
  /** When true, tracker agents are manual — show a trigger button in the widget strip */
  manualTrackers?: boolean;
  /** When provided, overrides the globally-computed set so that only per-chat agents show widgets. */
  enabledAgentTypes?: Set<string>;
}

const RoleplayHUDActionsMenu = lazy(async () =>
  import("./RoleplayHUDActionsMenu").then((module) => ({ default: module.RoleplayHUDActionsMenu })),
);
const CombinedPlayerPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.CombinedPlayerPanel })),
);
const PersonaStatsPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.PersonaStatsPanel })),
);
const CharactersPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.CharactersPanel })),
);
const InventoryPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.InventoryPanel })),
);
const QuestsPanel = lazy(async () => import("./RoleplayHUDPanels").then((module) => ({ default: module.QuestsPanel })));
const CustomTrackerPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.CustomTrackerPanel })),
);
const CombinedWorldPanel = lazy(async () =>
  import("./RoleplayHUDPanels").then((module) => ({ default: module.CombinedWorldPanel })),
);

export function RoleplayHUD({
  chatId,
  characterCount: _characterCount,
  layout = "top",
  isStreaming,
  onRetriggerTrackers,
  onRerunSingleTracker,
  onRetryFailedAgents,
  manualTrackers,
  mobileCompact,
  enabledAgentTypes: enabledAgentTypesProp,
}: RoleplayHUDProps & { mobileCompact?: boolean }) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const gameState = useGameStateStore((s) => s.current);
  const setGameState = useGameStateStore((s) => s.setGameState);
  const setFlushPatch = useGameStateStore((s) => s.setFlushPatch);

  const { data: agentConfigs } = useAgentConfigs();
  const globalEnabledAgentTypes = useMemo(() => {
    const set = new Set<string>();
    if (agentConfigs) {
      for (const a of agentConfigs as Array<{ type: string; enabled: string }>) {
        if (a.enabled === "true") set.add(a.type);
      }
    }
    return set;
  }, [agentConfigs]);
  const enabledAgentTypes = enabledAgentTypesProp ?? globalEnabledAgentTypes;

  const thoughtBubbles = useAgentStore((s) => s.thoughtBubbles);
  const isAgentProcessing = useAgentStore((s) => s.isProcessing);
  const failedAgentTypes = useAgentStore((s) => s.failedAgentTypes);
  const dismissThoughtBubble = useAgentStore((s) => s.dismissThoughtBubble);
  const clearThoughtBubbles = useAgentStore((s) => s.clearThoughtBubbles);
  const resetAgentStore = useAgentStore((s) => s.reset);

  const isTrackerBusy = isAgentProcessing || isStreaming;

  useEffect(() => {
    if (!chatId) return;
    // If the store already holds state for this chat, skip the redundant fetch.
    // This happens when ChatArea remounts after visiting an editor panel.
    const existing = useGameStateStore.getState().current;
    if (existing?.chatId === chatId) return;

    let cancelled = false;
    api
      .get<GameState | null>(`/chats/${chatId}/game-state`)
      .then((gs) => {
        if (!cancelled) setGameState(gs ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chatId, setGameState]);

  // Debounced API patch — batches rapid field changes into a single call
  const patchQueueRef = useRef<Record<string, unknown>>({});
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const patchField = useCallback(
    (field: string, value: unknown) => {
      // Optimistic local update
      const prev = gameStateRef.current;
      if (prev) {
        setGameState({ ...prev, [field]: value });
      } else {
        setGameState({
          id: "",
          chatId,
          messageId: "",
          swipeIndex: 0,
          date: null,
          time: null,
          location: null,
          weather: null,
          temperature: null,
          presentCharacters: [],
          recentEvents: [],
          playerStats: null,
          personaStats: null,
          createdAt: "",
          [field]: value,
        } as GameState);
      }
      // Queue the field for a batched API call
      patchQueueRef.current[field] = value;
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => {
        const payload = { ...patchQueueRef.current, manual: true };
        patchQueueRef.current = {};
        api.patch(`/chats/${chatId}/game-state`, payload).catch(() => {});
      }, 500);
    },
    [chatId, setGameState],
  );

  // Expose a flush function so generation can await pending patches before firing
  const flushPatch = useCallback(async () => {
    if (patchTimerRef.current) {
      clearTimeout(patchTimerRef.current);
      patchTimerRef.current = null;
    }
    const queued = patchQueueRef.current;
    if (Object.keys(queued).length === 0) return;
    const payload = { ...queued, manual: true };
    patchQueueRef.current = {};
    await api.patch(`/chats/${chatId}/game-state`, payload).catch(() => {});
  }, [chatId]);

  useEffect(() => {
    setFlushPatch(flushPatch);
    return () => setFlushPatch(null);
  }, [flushPatch, setFlushPatch]);

  // Flush pending patches on page unload so edits aren't lost on refresh
  useEffect(() => {
    const onBeforeUnload = () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      const queued = patchQueueRef.current;
      if (Object.keys(queued).length === 0) return;
      const payload = { ...queued, manual: true };
      patchQueueRef.current = {};
      // keepalive lets the request outlive the page
      fetch(`/api/chats/${chatId}/game-state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [chatId]);

  const patchPlayerStats = useCallback(
    (field: string, value: unknown) => {
      const current = gameStateRef.current?.playerStats ?? {
        stats: [],
        attributes: null,
        skills: {},
        inventory: [],
        activeQuests: [],
        status: "",
      };
      const next = { ...current, [field]: value };
      patchField("playerStats", next);
    },
    [patchField],
  );

  const clearGameState = useCallback(() => {
    const cleared = {
      date: null,
      time: null,
      location: null,
      weather: null,
      temperature: null,
      presentCharacters: [],
      recentEvents: [],
      playerStats: {
        stats: [],
        attributes: null,
        skills: {},
        inventory: [],
        activeQuests: [],
        status: "",
      },
      personaStats: [],
    };
    const prev = gameStateRef.current;
    if (prev) {
      setGameState({ ...prev, ...cleared } as GameState);
    } else {
      setGameState({
        id: "",
        chatId,
        messageId: "",
        swipeIndex: 0,
        createdAt: "",
        ...cleared,
      } as GameState);
    }
    api.patch(`/chats/${chatId}/game-state`, { ...cleared, manual: true, clearOverrides: true }).catch(() => {});
    // Clear committed agent runs & memory from DB + reset client state
    api.delete(`/agents/runs/${chatId}`).catch(() => {});
    resetAgentStore();
  }, [chatId, setGameState, resetAgentStore]);

  const date = gameState?.date ?? null;
  const time = gameState?.time ?? null;
  const location = gameState?.location ?? null;
  const weather = gameState?.weather ?? null;
  const temperature = gameState?.temperature ?? null;
  const presentCharacters = gameState?.presentCharacters ?? [];
  const personaStatBars = gameState?.personaStats ?? [];
  const playerStats = gameState?.playerStats ?? null;
  const personaStatus = playerStats?.status ?? "";
  const inventory = playerStats?.inventory ?? [];
  const activeQuests = playerStats?.activeQuests ?? [];
  const customTrackerFields = playerStats?.customTrackerFields ?? [];

  const isVertical = layout === "left" || layout === "right";
  // If mobileCompact, widgets are even narrower and action buttons are not cut off

  return (
    <div
      className={cn(
        "rpg-hud",
        isVertical ? "flex flex-col items-center gap-1.5" : "flex items-center gap-1.5",
        mobileCompact && "flex-1 min-w-0",
      )}
    >
      {/* Actions (Agents + Clear) */}
      <ActionsGroup
        isVertical={isVertical}
        agentsOpen={agentsOpen}
        setAgentsOpen={setAgentsOpen}
        isAgentProcessing={isAgentProcessing}
        thoughtBubbles={thoughtBubbles}
        clearThoughtBubbles={clearThoughtBubbles}
        dismissThoughtBubble={dismissThoughtBubble}
        enabledAgentTypes={enabledAgentTypes}
        clearGameState={clearGameState}
        onRetriggerTrackers={onRetriggerTrackers}
        onRetryFailedAgents={onRetryFailedAgents}
        failedAgentTypes={failedAgentTypes}
      />

      {/* ── Mobile: combined widgets, centered ── */}
      <div className={cn("flex items-center gap-0.5 md:hidden", mobileCompact && "flex-1 justify-center")}>
        {enabledAgentTypes.has("world-state") && (
          <CombinedWorldWidget
            location={location ?? ""}
            date={date ?? ""}
            time={time ?? ""}
            weather={weather ?? ""}
            temperature={temperature ?? ""}
            onSaveLocation={(v) => patchField("location", v)}
            onSaveDate={(v) => patchField("date", v)}
            onSaveTime={(v) => patchField("time", v)}
            onSaveWeather={(v) => patchField("weather", v)}
            onSaveTemperature={(v) => patchField("temperature", v)}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {(enabledAgentTypes.has("persona-stats") ||
          enabledAgentTypes.has("character-tracker") ||
          enabledAgentTypes.has("quest") ||
          enabledAgentTypes.has("custom-tracker")) && (
          <CombinedPlayerWidget
            layout={layout}
            showPersona={enabledAgentTypes.has("persona-stats")}
            showCharacters={enabledAgentTypes.has("character-tracker")}
            showQuests={enabledAgentTypes.has("quest")}
            showCustomTracker={enabledAgentTypes.has("custom-tracker")}
            personaStats={personaStatBars}
            onUpdatePersonaStats={(bars) => patchField("personaStats", bars)}
            personaStatus={personaStatus}
            onUpdatePersonaStatus={(status) => patchPlayerStats("status", status)}
            characters={presentCharacters}
            onUpdateCharacters={(chars) => {
              if (gameState) {
                setGameState({ ...gameState, presentCharacters: chars });
              }
              api.patch(`/chats/${chatId}/game-state`, { presentCharacters: chars }).catch(() => {});
            }}
            inventory={inventory}
            onUpdateInventory={(items) => patchPlayerStats("inventory", items)}
            quests={activeQuests}
            onUpdateQuests={(q) => patchPlayerStats("activeQuests", q)}
            customTrackerFields={customTrackerFields}
            onUpdateCustomTracker={(fields) => patchPlayerStats("customTrackerFields", fields)}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {/* Manual tracker trigger button (mobile) */}
        {manualTrackers && onRetriggerTrackers && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onRetriggerTrackers();
            }}
            disabled={isTrackerBusy}
            className={cn(
              MOBILE_HUD_BTN,
              "justify-center text-[0.5625rem] font-medium",
              isTrackerBusy ? "text-purple-600 dark:text-purple-300" : "text-[var(--muted-foreground)]",
            )}
          >
            <RefreshCw size="0.875rem" className={cn("shrink-0 h-4 w-4", isTrackerBusy && "animate-spin")} />
          </button>
        )}
      </div>

      {/* ── Desktop: separate individual widgets ── */}
      <div className="hidden md:flex items-center gap-1.5">
        {enabledAgentTypes.has("world-state") && (
          <CombinedWorldWidget
            location={location ?? ""}
            date={date ?? ""}
            time={time ?? ""}
            weather={weather ?? ""}
            temperature={temperature ?? ""}
            onSaveLocation={(v) => patchField("location", v)}
            onSaveDate={(v) => patchField("date", v)}
            onSaveTime={(v) => patchField("time", v)}
            onSaveWeather={(v) => patchField("weather", v)}
            onSaveTemperature={(v) => patchField("temperature", v)}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {enabledAgentTypes.has("persona-stats") && (
          <PersonaStatsWidget
            bars={personaStatBars}
            onUpdate={(bars) => patchField("personaStats", bars)}
            status={personaStatus}
            onUpdateStatus={(status) => patchPlayerStats("status", status)}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {enabledAgentTypes.has("character-tracker") && (
          <CharactersWidget
            characters={presentCharacters}
            onUpdate={(chars) => {
              if (gameState) {
                setGameState({ ...gameState, presentCharacters: chars });
              }
              api.patch(`/chats/${chatId}/game-state`, { presentCharacters: chars }).catch(() => {});
            }}
            chatId={chatId}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {enabledAgentTypes.has("persona-stats") && (
          <InventoryWidget
            items={inventory}
            onUpdate={(items) => patchPlayerStats("inventory", items)}
            layout={layout}
          />
        )}

        {enabledAgentTypes.has("quest") && (
          <QuestsWidget
            quests={activeQuests}
            onUpdate={(q) => patchPlayerStats("activeQuests", q)}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {enabledAgentTypes.has("custom-tracker") && (
          <CustomTrackerWidget
            fields={customTrackerFields}
            onUpdate={(fields) => patchPlayerStats("customTrackerFields", fields)}
            layout={layout}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerBusy}
          />
        )}

        {/* Manual tracker trigger button (desktop) */}
        {manualTrackers && onRetriggerTrackers && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onRetriggerTrackers();
            }}
            disabled={isTrackerBusy}
            className={cn(WIDGET, isTrackerBusy ? "text-purple-300" : "text-[var(--muted-foreground)]")}
            title={isTrackerBusy ? "Trackers running…" : "Run Trackers"}
          >
            <RefreshCw size="0.875rem" className={cn(isTrackerBusy && "animate-spin")} />
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Actions Group (Agents dropdown, Echo Chamber toggle, Clear)
// ═══════════════════════════════════════════════

/** Common mobile HUD button sizing – used by all four strip buttons */
const MOBILE_HUD_BTN =
  "flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md px-2 py-1.5 transition-all hover:bg-[var(--card)] dark:border-foreground/10 dark:bg-black/40 dark:hover:bg-black/60 cursor-pointer select-none";

function DeferredHUDPanelFallback({ label }: { label: string }) {
  return <div className="px-3 py-4 text-center text-[0.625rem] text-[var(--muted-foreground)]/60">{label}</div>;
}

function DeferredActionsFallback({ isAgentProcessing }: { isAgentProcessing: boolean }) {
  return (
    <div className="px-3 py-4 text-center text-[0.625rem] text-[var(--muted-foreground)]/60">
      {isAgentProcessing ? "Loading agent activity…" : "Loading actions…"}
    </div>
  );
}

interface ActionsGroupProps {
  isVertical: boolean;
  agentsOpen: boolean;
  setAgentsOpen: (v: boolean) => void;
  isAgentProcessing: boolean;
  thoughtBubbles: Array<{ agentId: string; agentName: string; content: string; timestamp: number }>;
  clearThoughtBubbles: () => void;
  dismissThoughtBubble: (i: number) => void;
  enabledAgentTypes: Set<string>;
  clearGameState: () => void;
  onRetriggerTrackers?: () => void;
  onRetryFailedAgents?: () => void;
  failedAgentTypes: string[];
}

function ActionsGroup({
  isVertical: _isVertical,
  agentsOpen,
  setAgentsOpen,
  isAgentProcessing,
  thoughtBubbles,
  clearThoughtBubbles,
  dismissThoughtBubble,
  enabledAgentTypes,
  clearGameState,
  onRetriggerTrackers,
  onRetryFailedAgents,
  failedAgentTypes,
}: ActionsGroupProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const echoChamberOpen = useUIStore((s) => s.echoChamberOpen);
  const toggleEchoChamber = useUIStore((s) => s.toggleEchoChamber);
  const echoMessages = useAgentStore((s) => s.echoMessages);
  const showEcho = enabledAgentTypes.has("echo-chamber");

  // Position with fixed layout to avoid overflow clipping
  useLayoutEffect(() => {
    if (!agentsOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const maxH = 320;
    const top = rect.bottom + 4 + maxH > window.innerHeight ? rect.top - maxH - 4 : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - 288 - 8);
    setPos({ top, left });
  }, [agentsOpen]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!agentsOpen) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || dropdownRef.current?.contains(e.target as Node)) return;
      setAgentsOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAgentsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [agentsOpen, setAgentsOpen]);

  // Badge count — unique agent types that produced results
  const uniqueAgentCount = new Set(thoughtBubbles.map((b) => b.agentId)).size;
  const badgeCount = uniqueAgentCount + (echoMessages.length > 0 ? 1 : 0);

  // ── Shared dropdown portal (used by both desktop & mobile) ──
  const dropdownContent =
    agentsOpen &&
    pos &&
    createPortal(
      <div
        ref={dropdownRef}
        className="fixed w-72 max-w-[calc(100vw-1rem)] max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--popover)] backdrop-blur-xl shadow-xl z-[9999] animate-message-in dark:border-foreground/10 dark:bg-black/80"
        style={{ top: pos.top, left: pos.left }}
      >
        <Suspense fallback={<DeferredActionsFallback isAgentProcessing={isAgentProcessing} />}>
          <RoleplayHUDActionsMenu
            isAgentProcessing={isAgentProcessing}
            thoughtBubbles={thoughtBubbles}
            clearThoughtBubbles={clearThoughtBubbles}
            dismissThoughtBubble={dismissThoughtBubble}
            showEcho={showEcho}
            echoChamberOpen={echoChamberOpen}
            toggleEchoChamber={toggleEchoChamber}
            echoMessageCount={echoMessages.length}
            clearGameState={clearGameState}
            onRetriggerTrackers={onRetriggerTrackers}
            onRetryFailedAgents={onRetryFailedAgents}
            failedAgentTypes={failedAgentTypes}
            onClose={() => setAgentsOpen(false)}
          />
        </Suspense>
      </div>,
      document.body,
    );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setAgentsOpen(!agentsOpen)}
        className={cn(
          "flex items-center gap-1.5 md:gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md px-2 py-1.5 md:px-2 md:py-2 md:h-10 transition-all hover:bg-[var(--card)] dark:border-foreground/10 dark:bg-black/40 dark:hover:bg-black/60 cursor-pointer select-none",
          agentsOpen && "bg-[var(--card)] border-[var(--border)] dark:bg-black/60 dark:border-foreground/20",
        )}
        title="Agents & Actions"
      >
        <Sparkles
          size="0.875rem"
          strokeWidth={2.5}
          className={cn("text-purple-400/70 shrink-0", isAgentProcessing && "animate-pulse")}
        />
        {showEcho && (
          <MessageCircle
            size="0.8125rem"
            strokeWidth={2.5}
            className={cn(echoChamberOpen ? "text-purple-400" : "text-purple-400/50", "shrink-0")}
          />
        )}
        <Trash2 size="0.8125rem" strokeWidth={2.5} className="text-purple-400/50 shrink-0" />
        {badgeCount > 0 && (
          <span className="hidden md:flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-purple-500/80 px-1 text-[0.5rem] font-bold text-foreground">
            {badgeCount}
          </span>
        )}
        {failedAgentTypes.length > 0 && (
          <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500/80 px-1 text-[0.5rem] font-bold text-foreground">
            {failedAgentTypes.length}
          </span>
        )}
      </button>
      {dropdownContent}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Echo Chamber Toggle Button (desktop only — mobile folded into ActionsGroup)
// ═══════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EchoChamberToggle() {
  const echoChamberOpen = useUIStore((s) => s.echoChamberOpen);
  const toggleEchoChamber = useUIStore((s) => s.toggleEchoChamber);
  const echoMessages = useAgentStore((s) => s.echoMessages);

  return (
    <button
      onClick={toggleEchoChamber}
      className={cn(
        "flex items-center gap-1 rounded-full bg-[var(--muted)]/20 border border-[var(--border)] px-2 py-1 text-[0.625rem] text-[var(--foreground)]/70 backdrop-blur-md transition-all hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)] dark:bg-foreground/5 dark:border-foreground/10 dark:text-foreground/60 dark:hover:bg-foreground/10 dark:hover:text-foreground",
        echoChamberOpen && "bg-purple-500/20 text-purple-600 border-purple-500/30 dark:text-purple-300",
      )}
      title="Toggle Echo Chamber panel"
    >
      <MessageCircle size="0.625rem" className="text-purple-400/70" />
      <span>Echo</span>
      {echoMessages.length > 0 && (
        <span className="flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-purple-500/80 px-1 text-[0.5rem] font-bold text-foreground">
          {echoMessages.length}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════
// Combined Player Widget — merges Persona, Chars,
// Inventory, and Quests into a single expandable panel
// ═══════════════════════════════════════════════

function CombinedPlayerWidget({
  layout = "top",
  showPersona,
  showCharacters,
  showQuests,
  showCustomTracker,
  personaStats,
  onUpdatePersonaStats,
  personaStatus,
  onUpdatePersonaStatus,
  characters,
  onUpdateCharacters,
  inventory,
  onUpdateInventory,
  quests,
  onUpdateQuests,
  customTrackerFields,
  onUpdateCustomTracker,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  layout?: HudPosition;
  showPersona: boolean;
  showCharacters: boolean;
  showQuests: boolean;
  showCustomTracker: boolean;
  personaStats: CharacterStat[];
  onUpdatePersonaStats: (bars: CharacterStat[]) => void;
  personaStatus: string;
  onUpdatePersonaStatus: (status: string) => void;
  characters: PresentCharacter[];
  onUpdateCharacters: (chars: PresentCharacter[]) => void;
  inventory: InventoryItem[];
  onUpdateInventory: (items: InventoryItem[]) => void;
  quests: QuestProgress[];
  onUpdateQuests: (quests: QuestProgress[]) => void;
  customTrackerFields: CustomTrackerField[];
  onUpdateCustomTracker: (fields: CustomTrackerField[]) => void;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(WIDGET, "text-orange-300")}
        title="Player & Tracker"
      >
        <div className="flex h-7 max-md:h-auto items-center justify-center shrink-0">
          <Swords size="0.875rem" className="text-orange-400/70 max-md:h-4 max-md:w-4" />
        </div>
        <span className="max-w-full truncate text-[0.5625rem] font-semibold leading-tight shrink-0 max-md:hidden">
          Tracker
        </span>
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-80 max-h-[min(75vh,32rem)]"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading trackers…" />}>
          <CombinedPlayerPanel
            showPersona={showPersona}
            showCharacters={showCharacters}
            showQuests={showQuests}
            showCustomTracker={showCustomTracker}
            personaStats={personaStats}
            onUpdatePersonaStats={onUpdatePersonaStats}
            personaStatus={personaStatus}
            onUpdatePersonaStatus={onUpdatePersonaStatus}
            characters={characters}
            onUpdateCharacters={onUpdateCharacters}
            inventory={inventory}
            onUpdateInventory={onUpdateInventory}
            quests={quests}
            onUpdateQuests={onUpdateQuests}
            customTrackerFields={customTrackerFields}
            onUpdateCustomTracker={onUpdateCustomTracker}
            onClose={() => setOpen(false)}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

/** Shared popover wrapper used by tracker widgets — renders via portal to escape overflow clipping */
function WidgetPopover({
  open,
  onClose,
  anchorRef,
  placement = "bottom",
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: "bottom" | "right" | "left";
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const computePosition = useCallback(() => {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const popoverWidth = ref.current?.offsetWidth ?? 288;
    const popoverHeight = ref.current?.offsetHeight ?? 200;
    let top: number;
    let left: number;

    if (placement === "right") {
      left = rect.right + 4;
      top = rect.top;
      if (top + popoverHeight > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - popoverHeight - 8);
      }
    } else if (placement === "left") {
      left = rect.left - popoverWidth - 4;
      top = rect.top;
      if (left < 8) left = 8;
      if (top + popoverHeight > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - popoverHeight - 8);
      }
    } else {
      // Bottom placement — center horizontally on screen for mobile
      top = rect.bottom + 4;
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        left = Math.round((window.innerWidth - popoverWidth) / 2);
      } else {
        left = rect.left;
        if (left + popoverWidth > window.innerWidth - 8) {
          left = Math.max(8, window.innerWidth - popoverWidth - 8);
        }
      }
    }
    return { top, left };
  }, [anchorRef, placement]);

  // Position the popover relative to the anchor element
  useLayoutEffect(() => {
    if (!open) return;
    setPos(computePosition());
  }, [open, computePosition]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const update = () => setPos(computePosition());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !anchorRef.current?.contains(target)) {
        // Delay close so that the input's blur event fires first, committing any edits
        requestAnimationFrame(() => onClose());
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      style={pos ? { position: "fixed", top: pos.top, left: pos.left } : { position: "fixed", top: -9999, left: -9999 }}
      className={cn(
        "z-[9999] max-w-[calc(100vw-1rem)] animate-message-in rounded-xl border border-[var(--border)] bg-[var(--popover)] backdrop-blur-xl shadow-xl dark:border-foreground/10 dark:bg-black/80",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Present Characters Widget ────────────────

function CharactersWidget({
  characters,
  onUpdate,
  chatId,
  layout = "top",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  characters: PresentCharacter[];
  onUpdate: (chars: PresentCharacter[]) => void;
  chatId: string;
  layout?: HudPosition;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(WIDGET, "text-purple-500 dark:text-purple-300")}
        title="Present Characters"
      >
        {characters.length > 0 ? (
          <div className="flex items-center -space-x-0.5">
            {characters.slice(0, 3).map((c, i) => (
              <span key={i} className="text-xs max-md:text-[0.5625rem] leading-none">
                {c.emoji || "👤"}
              </span>
            ))}
            {characters.length > 3 && (
              <span className="text-[0.4375rem] text-[var(--muted-foreground)]/60 ml-0.5">
                +{characters.length - 3}
              </span>
            )}
          </div>
        ) : (
          <Users size="0.875rem" className="text-purple-400/50 max-md:h-3.5 max-md:w-3.5" />
        )}
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-72 max-h-80 overflow-y-auto"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading characters…" />}>
          <CharactersPanel
            characters={characters}
            onUpdate={onUpdate}
            chatId={chatId}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ── Persona Stats Widget ─────────────────────

function PersonaStatsWidget({
  bars,
  onUpdate,
  status,
  onUpdateStatus,
  layout = "top",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  bars: CharacterStat[];
  onUpdate: (bars: CharacterStat[]) => void;
  status: string;
  onUpdateStatus: (status: string) => void;
  layout?: HudPosition;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(WIDGET, "text-violet-300")}
        title="Persona Stats"
      >
        {bars.length > 0 ? (
          <div className="flex w-6 max-md:w-8 flex-col justify-center gap-0.5 max-md:gap-px shrink-0">
            {bars.map((bar) => {
              const pct = bar.max > 0 ? Math.min(100, (bar.value / bar.max) * 100) : 0;
              return (
                <div
                  key={bar.name}
                  className="h-1 max-md:h-px w-full rounded-full bg-[var(--muted)]/30 dark:bg-foreground/10 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: bar.color || "#8b5cf6" }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <BarChart3 size="0.875rem" className="text-violet-400/40 max-md:h-3.5 max-md:w-3.5" />
        )}
        <span className="max-w-full truncate text-[0.5625rem] max-md:text-[0.4375rem] font-semibold leading-tight shrink-0 md:hidden">
          Persona
        </span>
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-60 max-h-80 overflow-y-auto"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading persona stats…" />}>
          <PersonaStatsPanel
            bars={bars}
            onUpdate={onUpdate}
            status={status}
            onUpdateStatus={onUpdateStatus}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ── Custom Tracker Widget ────────────────────

function CustomTrackerWidget({
  fields,
  onUpdate,
  layout = "top",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  fields: CustomTrackerField[];
  onUpdate: (fields: CustomTrackerField[]) => void;
  layout?: HudPosition;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  // Cycle through fields every 3 seconds
  useEffect(() => {
    if (fields.length <= 1) return;
    const timer = setInterval(() => {
      setCycleIdx((prev) => (prev + 1) % fields.length);
      setAnimKey((k) => k + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, [fields.length]);

  useEffect(() => {
    if (cycleIdx >= fields.length) setCycleIdx(0);
  }, [fields.length, cycleIdx]);

  const currentField = fields[cycleIdx];
  const previewLabel = currentField
    ? currentField.value
      ? `${currentField.name}: ${currentField.value}`
      : currentField.name
    : "";
  const longestWord = previewLabel.split(/\s+/).reduce((max, w) => Math.max(max, w.length), 0);
  const previewFontSize = Math.max(3.5, Math.min(6, 60 / Math.max(longestWord, 1)));

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(WIDGET, "text-cyan-300")}
        title="Custom Tracker"
      >
        {fields.length > 0 && currentField ? (
          <span
            key={animKey}
            className="w-full px-0.5 text-center font-semibold leading-[1.2] animate-[inventory-cycle_0.4s_ease-out]"
            style={{ fontSize: `${previewFontSize}px` }}
          >
            {previewLabel}
          </span>
        ) : (
          <SlidersHorizontal size="0.875rem" className="text-cyan-400/60 max-md:h-3 max-md:w-3" />
        )}
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-72 max-h-80 overflow-y-auto"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading custom tracker…" />}>
          <CustomTrackerPanel
            fields={fields}
            onUpdate={onUpdate}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ── Inventory Widget ─────────────────────────

function InventoryWidget({
  items,
  onUpdate,
  layout = "top",
}: {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
  layout?: HudPosition;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  // Cycle through items every 3 seconds
  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setCycleIdx((prev) => (prev + 1) % items.length);
      setAnimKey((k) => k + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, [items.length]);

  // Reset index if items shrink
  useEffect(() => {
    if (cycleIdx >= items.length) setCycleIdx(0);
  }, [items.length, cycleIdx]);

  const currentItem = items[cycleIdx];

  // Auto-shrink font so the longest word fits on one line within ~36px usable width
  const itemLabel = currentItem
    ? currentItem.quantity > 1
      ? `${currentItem.name} ×${currentItem.quantity}`
      : currentItem.name
    : "";
  const longestWord = itemLabel.split(/\s+/).reduce((max, w) => Math.max(max, w.length), 0);
  // ~0.6em per char at a given font size; widget inner ≈ 36px → fontSize ≤ 60/longestWord
  const itemFontSize = Math.max(3.5, Math.min(6, 60 / Math.max(longestWord, 1)));

  return (
    <div className="relative">
      <button ref={buttonRef} onClick={() => setOpen(!open)} className={cn(WIDGET, "text-amber-300")} title="Inventory">
        {items.length > 0 && currentItem ? (
          <span
            key={animKey}
            className="w-full px-0.5 text-center font-semibold leading-[1.2] animate-[inventory-cycle_0.4s_ease-out]"
            style={{ fontSize: `${itemFontSize}px` }}
          >
            {itemLabel}
          </span>
        ) : (
          <Package size="0.875rem" className="text-amber-400/60 max-md:h-3 max-md:w-3" />
        )}
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-64 max-h-80 overflow-y-auto"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading inventory…" />}>
          <InventoryPanel items={items} onUpdate={onUpdate} />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ── Quests Widget ────────────────────────────

function QuestsWidget({
  quests,
  onUpdate,
  layout = "top",
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  quests: QuestProgress[];
  onUpdate: (quests: QuestProgress[]) => void;
  layout?: HudPosition;
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Find the first incomplete objective from the most recent incomplete quest
  const incompleteQuests = quests.filter((q) => !q.completed);
  const mainQuest = incompleteQuests.length > 0 ? incompleteQuests[incompleteQuests.length - 1] : undefined;
  const currentObjective = mainQuest?.objectives.find((o) => !o.completed);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(WIDGET, "text-emerald-300")}
        title="Active Quests"
      >
        {currentObjective ? (
          <span className="widget-scroll-text w-full px-0.5 text-center text-[0.375rem] font-semibold leading-[1.15] max-md:text-[0.5rem]">
            <span className="inline-flex animate-[widget-scroll_8s_linear_infinite] whitespace-nowrap">
              <span className="px-3">{currentObjective.text}</span>
              <span className="px-3" aria-hidden>
                {currentObjective.text}
              </span>
            </span>
          </span>
        ) : (
          <Scroll size="0.875rem" className="text-emerald-400/60 max-md:h-3 max-md:w-3" />
        )}
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-72 max-h-96 overflow-y-auto"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading quests…" />}>
          <QuestsPanel
            quests={quests}
            onUpdate={onUpdate}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Uniform World-State Widgets
// ═══════════════════════════════════════════════

const WIDGET =
  "group flex w-10 h-10 max-md:w-auto max-md:h-auto max-md:px-2 max-md:py-1.5 flex-col items-center justify-center gap-0.5 max-md:gap-0 rounded-xl max-md:rounded-lg border border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md transition-all hover:bg-[var(--card)] dark:border-foreground/15 dark:bg-black/40 dark:hover:bg-black/60 cursor-pointer select-none overflow-hidden";
const WIDGET_EDIT =
  "flex w-10 h-10 max-md:w-auto max-md:h-auto max-md:px-2 max-md:py-1.5 flex-col items-center justify-center gap-0.5 max-md:gap-0 rounded-xl max-md:rounded-lg border border-[var(--border)] bg-[var(--card)] backdrop-blur-md dark:border-foreground/15 dark:bg-black/60 overflow-hidden";

/** Hook: mobile single-tap = tooltip, double-tap = edit; desktop click = edit */
function useWidgetTap(onEdit: () => void) {
  const [showTip, setShowTip] = useState(false);
  const lastTapRef = useRef(0);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  const handleTouchStart = useCallback(() => {
    isTouchRef.current = true;
  }, []);

  const handleClick = useCallback(() => {
    if (!isTouchRef.current) {
      onEdit();
      return;
    }
    isTouchRef.current = false;
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      setShowTip(false);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      onEdit();
    } else {
      setShowTip(true);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      tipTimerRef.current = setTimeout(() => setShowTip(false), 2000);
    }
    lastTapRef.current = now;
  }, [onEdit]);

  return { showTip, handleClick, handleTouchStart };
}

/** Truncated label with optional tooltip */
function WidgetLabel({
  value,
  fallback,
  showTip,
  className,
}: {
  value: string;
  fallback: string;
  showTip?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative w-full max-md:px-0.5", className)}>
      <span
        className={cn(
          "block mx-auto max-w-[4.5rem] max-md:max-w-full overflow-x-auto scrollbar-hide whitespace-nowrap text-center text-[0.5625rem] max-md:text-[0.4375rem] font-semibold leading-tight",
          !value && "italic opacity-40",
        )}
      >
        {value || fallback}
      </span>
      {showTip && value && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded bg-[var(--popover)] border border-[var(--border)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--foreground)]/80 z-[9999] pointer-events-none animate-message-in dark:bg-black/90 dark:border-foreground/10 dark:text-foreground/80">
          {value}
        </span>
      )}
    </span>
  );
}

function WidgetInput({
  value,
  onSave,
  onCancel,
  accent,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  accent: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== value) onSave(t);
    onCancel();
  };
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
      className={cn(
        "w-[4.5rem] max-md:w-full max-md:px-0.5 bg-transparent text-center text-[0.5625rem] max-md:text-[0.625rem] font-medium outline-none placeholder:text-[var(--muted-foreground)]/40 dark:placeholder:text-foreground/20",
        accent,
      )}
    />
  );
}

// ═══════════════════════════════════════════════
// Combined World-State Widget (icon strip + popover, desktop & mobile)
// ═══════════════════════════════════════════════

function CombinedWorldWidget({
  location,
  date,
  time,
  weather,
  temperature,
  onSaveLocation,
  onSaveDate,
  onSaveTime,
  onSaveWeather,
  onSaveTemperature,
  layout,
  onRerunSingleTracker,
  isTrackerRetryBusy,
}: {
  location: string;
  date: string;
  time: string;
  weather: string;
  temperature: string;
  onSaveLocation: (v: string) => void;
  onSaveDate: (v: string) => void;
  onSaveTime: (v: string) => void;
  onSaveWeather: (v: string) => void;
  onSaveTemperature: (v: string) => void;
  layout: "top" | "left" | "right";
  onRerunSingleTracker?: (agentType: string) => void;
  isTrackerRetryBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const weatherEmoji = weather ? getWeatherEmoji(weather) : "🌤️";
  const pinColor = getLocationPinColor(location);
  const tempNumeric = temperature ? parseTemperature(temperature) : null;
  const temp = tempNumeric ?? (temperature ? getTemperatureKeywordHint(temperature) : null);
  const tempColor =
    temp !== null
      ? temp < 0
        ? "text-blue-400"
        : temp < 15
          ? "text-sky-400"
          : temp < 30
            ? "text-amber-400"
            : "text-red-400"
      : "text-rose-400/50";

  // Dynamic calendar: show day number
  const dateParts = date ? parseDateLabel(date) : { day: null, month: null };

  // Dynamic clock: compute hand angles
  const hour = time ? extractHourFromTime(time) : -1;
  const minute = time ? parseMinutes(time) : 0;
  const hourAngle = hour >= 0 ? (hour % 12) * 30 + minute * 0.5 : 0;
  const minuteAngle = minute * 6;

  // Thermometer fill fraction (clamp -20..50°C → 0..1)
  const tempFill = temp !== null ? Math.max(0, Math.min(1, (temp + 20) / 70)) : 0.3;
  const tempFillColor =
    temp !== null ? (temp < 0 ? "#60a5fa" : temp < 15 ? "#38bdf8" : temp < 30 ? "#fbbf24" : "#f87171") : "#fb7185";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 md:gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 backdrop-blur-md px-2 py-1.5 md:px-2 md:py-2 md:h-10 transition-all hover:bg-[var(--card)] dark:border-foreground/10 dark:bg-black/40 dark:hover:bg-black/60 cursor-pointer select-none",
          open && "bg-[var(--card)] border-[var(--border)] dark:bg-black/60 dark:border-foreground/20",
        )}
        title="World State"
      >
        {/* Location pin */}
        <MapPin size="0.9375rem" className={cn(pinColor, "drop-shadow-sm shrink-0")} />

        {/* Mini calendar with day number */}
        <svg viewBox="0 0 20 20" fill="none" className="shrink-0 h-4 w-4">
          <rect
            x="2"
            y="4"
            width="16"
            height="14"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-violet-400/70"
          />
          <line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" strokeWidth="1.2" className="text-violet-400/50" />
          <line
            x1="6"
            y1="2"
            x2="6"
            y2="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-violet-400/70"
          />
          <line
            x1="14"
            y1="2"
            x2="14"
            y2="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-violet-400/70"
          />
          {dateParts.day && (
            <text
              x="10"
              y="15.5"
              textAnchor="middle"
              fill="currentColor"
              fontSize="7"
              fontWeight="700"
              className="text-violet-300"
            >
              {dateParts.day}
            </text>
          )}
        </svg>

        {/* Mini clock with dynamic hands */}
        <svg viewBox="0 0 20 20" fill="none" className="shrink-0 h-4 w-4">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" className="text-amber-400/70" />
          {hour >= 0 ? (
            <>
              <line
                x1="10"
                y1="10"
                x2={10 + 4.2 * Math.sin((hourAngle * Math.PI) / 180)}
                y2={10 - 4.2 * Math.cos((hourAngle * Math.PI) / 180)}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="text-amber-300"
              />
              <line
                x1="10"
                y1="10"
                x2={10 + 5.8 * Math.sin((minuteAngle * Math.PI) / 180)}
                y2={10 - 5.8 * Math.cos((minuteAngle * Math.PI) / 180)}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-amber-400/80"
              />
            </>
          ) : (
            <>
              <line
                x1="10"
                y1="10"
                x2="10"
                y2="5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="text-amber-300"
              />
              <line
                x1="10"
                y1="10"
                x2="14"
                y2="10"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-amber-400/80"
              />
            </>
          )}
          <circle cx="10" cy="10" r="1" fill="currentColor" className="text-amber-300" />
        </svg>

        {/* Weather emoji */}
        <span className="text-sm leading-none shrink-0">{weatherEmoji}</span>

        {/* Mini thermometer with fill — vivid color & fill level changes dynamically */}
        <svg viewBox="0 0 10 20" fill="none" className="shrink-0 h-4 w-[0.625rem]">
          <rect
            x="3"
            y="1"
            width="4"
            height="13"
            rx="2"
            stroke={tempFillColor}
            strokeWidth="1.2"
            fill="none"
            opacity={temp !== null ? 1 : 0.3}
          />
          <rect
            x="3.8"
            y={1 + 12 * (1 - tempFill)}
            width="2.4"
            height={12 * tempFill + 1}
            rx="1"
            fill={tempFillColor}
            opacity={temp !== null ? 0.9 : 0.2}
          />
          <circle cx="5" cy="17" r="2.5" fill={tempFillColor} opacity={temp !== null ? 1 : 0.25} />
        </svg>
        {tempNumeric !== null && (
          <span className={cn("text-[0.5rem] md:text-[0.5625rem] font-bold leading-none shrink-0", tempColor)}>
            {tempNumeric}°
          </span>
        )}
      </button>

      <WidgetPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement={layout === "left" ? "right" : layout === "right" ? "left" : "bottom"}
        className="w-64"
      >
        <Suspense fallback={<DeferredHUDPanelFallback label="Loading world state…" />}>
          <CombinedWorldPanel
            location={location}
            date={date}
            time={time}
            weather={weather}
            temperature={temperature}
            onSaveLocation={onSaveLocation}
            onSaveDate={onSaveDate}
            onSaveTime={onSaveTime}
            onSaveWeather={onSaveWeather}
            onSaveTemperature={onSaveTemperature}
            weatherEmoji={weatherEmoji}
            pinColor={pinColor}
            tempColor={tempColor}
            onClose={() => setOpen(false)}
            onRerunSingleTracker={onRerunSingleTracker}
            isTrackerRetryBusy={isTrackerRetryBusy}
          />
        </Suspense>
      </WidgetPopover>
    </div>
  );
}

// ── Location Widget ──────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LocationWidget({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { showTip, handleClick, handleTouchStart } = useWidgetTap(() => setEditing(true));

  if (editing) {
    return (
      <div className={cn(WIDGET_EDIT, "text-emerald-300")}>
        <MapPin size="0.875rem" className="text-emerald-400/60 mb-0.5 max-md:h-3 max-md:w-3 max-md:mb-0" />
        <WidgetInput value={value} onSave={onSave} onCancel={() => setEditing(false)} accent="text-emerald-300" />
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className={cn(WIDGET, "text-emerald-300", showTip && "z-50", className)}
      title={value || "Click to edit location"}
    >
      <div className="relative flex h-7 max-md:h-4 items-center justify-center shrink-0">
        <div className="absolute inset-0 rounded-md overflow-hidden opacity-40">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/60 via-emerald-800/40 to-emerald-950/60" />
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 56 28">
            <line
              x1="0"
              y1="9"
              x2="56"
              y2="9"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-emerald-400/30"
            />
            <line
              x1="0"
              y1="19"
              x2="56"
              y2="19"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-emerald-400/30"
            />
            <line
              x1="14"
              y1="0"
              x2="14"
              y2="28"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-emerald-400/30"
            />
            <line
              x1="28"
              y1="0"
              x2="28"
              y2="28"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-emerald-400/30"
            />
            <line
              x1="42"
              y1="0"
              x2="42"
              y2="28"
              stroke="currentColor"
              strokeWidth="0.3"
              className="text-emerald-400/30"
            />
            <circle cx="20" cy="14" r="5" fill="currentColor" className="text-emerald-600/20" />
            <circle cx="38" cy="10" r="4" fill="currentColor" className="text-emerald-600/15" />
            <path
              d="M8 20 Q14 12 22 18 Q30 24 40 16"
              stroke="currentColor"
              strokeWidth="0.5"
              fill="none"
              className="text-emerald-400/25"
            />
          </svg>
        </div>
        <MapPin
          size="0.875rem"
          className="relative text-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.5)] max-md:h-3 max-md:w-3"
        />
      </div>
      <WidgetLabel value={value} fallback="Location" showTip={showTip} />
    </button>
  );
}

// ── Calendar Widget ──────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CalendarWidget({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { showTip, handleClick, handleTouchStart } = useWidgetTap(() => setEditing(true));
  const { day, month } = value ? parseDateLabel(value) : { day: null, month: null };

  if (editing) {
    return (
      <div className={cn(WIDGET_EDIT, "text-violet-300")}>
        <CalendarDays size="0.875rem" className="text-violet-400/60 mb-0.5 max-md:h-3 max-md:w-3 max-md:mb-0" />
        <WidgetInput value={value} onSave={onSave} onCancel={() => setEditing(false)} accent="text-violet-300" />
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className={cn(WIDGET, "text-violet-300", showTip && "z-50", className)}
      title={value || "Click to edit date"}
    >
      <div className="flex h-7 max-md:h-4 flex-col rounded-sm border border-violet-400/30 overflow-hidden bg-violet-950/30 shrink-0">
        <div className="flex h-2.5 max-md:h-1.5 items-center justify-center bg-violet-500/25">
          <span className="text-[5px] max-md:text-[3px] font-bold uppercase tracking-wider text-violet-300/80">
            {month || "———"}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[0.75rem] max-md:text-[0.5rem] font-bold leading-none text-violet-200/80">
            {day || "?"}
          </span>
        </div>
      </div>
      <WidgetLabel value={value} fallback="Date" showTip={showTip} />
    </button>
  );
}

// ── Clock Widget ─────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ClockWidget({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const { showTip, handleClick, handleTouchStart } = useWidgetTap(() => setEditing(true));
  const hour = value ? extractHourFromTime(value) : -1;
  const hourAngle = hour >= 0 ? ((hour % 12) / 12) * 360 - 90 : -90;
  const minuteAngle = hour >= 0 ? (parseMinutes(value) / 60) * 360 - 90 : 90;

  if (editing) {
    return (
      <div className={cn(WIDGET_EDIT, "text-amber-300")}>
        <Clock size="0.875rem" className="text-amber-400/60 mb-0.5 max-md:h-3 max-md:w-3 max-md:mb-0" />
        <WidgetInput value={value} onSave={onSave} onCancel={() => setEditing(false)} accent="text-amber-300" />
      </div>
    );
  }

  const period = value ? getTimePeriod(value) : null;

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className={cn(WIDGET, "text-amber-300", showTip && "z-50", className)}
      title={value || "Click to edit time"}
    >
      <div className="relative flex h-7 max-md:h-4 items-center justify-center shrink-0">
        <svg viewBox="0 0 32 32" className="h-full w-full">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            className="text-amber-400/30"
          />
          <circle cx="16" cy="16" r="12.5" fill="currentColor" className="text-amber-950/30" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const x1 = 16 + Math.cos(a) * 10.5;
            const y1 = 16 + Math.sin(a) * 10.5;
            const x2 = 16 + Math.cos(a) * 12;
            const y2 = 16 + Math.sin(a) * 12;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="currentColor"
                strokeWidth={i % 3 === 0 ? "1" : "0.5"}
                className="text-amber-400/50"
              />
            );
          })}
          <line
            x1="16"
            y1="16"
            x2={16 + Math.cos((hourAngle * Math.PI) / 180) * 6.5}
            y2={16 + Math.sin((hourAngle * Math.PI) / 180) * 6.5}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            className="text-amber-300/80"
          />
          <line
            x1="16"
            y1="16"
            x2={16 + Math.cos((minuteAngle * Math.PI) / 180) * 9}
            y2={16 + Math.sin((minuteAngle * Math.PI) / 180) * 9}
            stroke="currentColor"
            strokeWidth="0.7"
            strokeLinecap="round"
            className="text-amber-200/60"
          />
          <circle cx="16" cy="16" r="1" fill="currentColor" className="text-amber-400/70" />
        </svg>
      </div>
      <WidgetLabel value={value || period || ""} fallback="Time" showTip={showTip} />
    </button>
  );
}

// ── Weather Widget ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WeatherWidget({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { showTip, handleClick, handleTouchStart } = useWidgetTap(() => setEditing(true));
  const emoji = value ? getWeatherEmoji(value) : "🌤️";

  if (editing) {
    return (
      <div className={cn(WIDGET_EDIT, "text-sky-300")}>
        <span className="text-base max-md:text-xs mb-0.5">{emoji}</span>
        <WidgetInput value={value} onSave={onSave} onCancel={() => setEditing(false)} accent="text-sky-300" />
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className={cn(WIDGET, "text-sky-300", showTip && "z-50", className)}
      title={value || "Click to edit weather"}
    >
      <div className="flex h-7 max-md:h-4 items-center justify-center shrink-0">
        <span className="text-xl max-md:text-xs leading-none drop-shadow-[0_0_6px_rgba(56,189,248,0.3)]">{emoji}</span>
      </div>
      <WidgetLabel value={value} fallback="Weather" showTip={showTip} />
    </button>
  );
}

// ── Temperature Widget ───────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TemperatureWidget({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { showTip, handleClick, handleTouchStart } = useWidgetTap(() => setEditing(true));
  const tempNumeric = value ? parseTemperature(value) : null;
  const temp = tempNumeric ?? (value ? getTemperatureKeywordHint(value) : null);
  const fillPct = temp !== null ? Math.max(5, Math.min(100, ((temp + 20) / 65) * 100)) : 40;
  const fillColor =
    temp !== null
      ? temp < 0
        ? "text-blue-400"
        : temp < 15
          ? "text-sky-400"
          : temp < 30
            ? "text-amber-400"
            : "text-red-400"
      : "text-rose-400/50";

  if (editing) {
    return (
      <div className={cn(WIDGET_EDIT, "text-rose-300")}>
        <Thermometer size="0.875rem" className="text-rose-400/60 mb-0.5 max-md:h-3 max-md:w-3 max-md:mb-0" />
        <WidgetInput value={value} onSave={onSave} onCancel={() => setEditing(false)} accent="text-rose-300" />
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className={cn(WIDGET, "text-rose-300", showTip && "z-50", className)}
      title={value || "Click to edit temperature"}
    >
      <div className="relative flex h-7 max-md:h-4 items-center justify-center shrink-0">
        <svg viewBox="0 0 16 32" className="h-full" style={{ width: "auto" }}>
          <rect
            x="5.5"
            y="3"
            width="5"
            height="20"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            className={temp !== null ? fillColor : "text-rose-400/20"}
          />
          <rect
            x="6.5"
            y={3 + 18 * (1 - fillPct / 100)}
            width="3"
            height={Math.max(1, 18 * (fillPct / 100))}
            rx="1.5"
            fill="currentColor"
            className={fillColor}
            opacity={temp !== null ? 1 : 0.2}
          />
          <circle
            cx="8"
            cy="26"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            className={temp !== null ? fillColor : "text-rose-400/20"}
          />
          <circle cx="8" cy="26" r="2.5" fill="currentColor" className={fillColor} opacity={temp !== null ? 1 : 0.25} />
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line
              key={i}
              x1="10.5"
              y1={3 + 18 * (1 - t)}
              x2="12"
              y2={3 + 18 * (1 - t)}
              stroke="currentColor"
              strokeWidth="0.4"
              className="text-rose-400/25"
            />
          ))}
        </svg>
      </div>
      <WidgetLabel value={tempNumeric !== null ? `${tempNumeric}°` : value} fallback="Temp" showTip={showTip} />
    </button>
  );
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function parseDateLabel(date: string): { day: string | null; month: string | null } {
  const numMatch = date.match(/(\d+)/);
  const day = numMatch ? numMatch[1] : null;
  const words = date
    .replace(/\d+(st|nd|rd|th)?/gi, "")
    .split(/[\s,/.-]+/)
    .filter((w) => w.length > 2);
  const month = words[0]?.slice(0, 3) ?? null;
  return { day, month };
}

function extractHourFromTime(time: string): number {
  const t = time.toLowerCase();
  const m24 = t.match(/\b(\d{1,2})[:.h](\d{2})\b/);
  if (m24) {
    let h = parseInt(m24[1]!, 10);
    if (t.includes("pm") && h < 12) h += 12;
    if (t.includes("am") && h === 12) h = 0;
    if (h >= 0 && h < 24) return h;
  }
  const mAP = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (mAP) {
    let h = parseInt(mAP[1]!, 10);
    if (mAP[2] === "pm" && h < 12) h += 12;
    if (mAP[2] === "am" && h === 12) h = 0;
    if (h >= 0 && h < 24) return h;
  }
  if (t.includes("midnight")) return 0;
  if (t.includes("dawn") || t.includes("sunrise")) return 6;
  if (t.includes("morning")) return 9;
  if (t.includes("noon") || t.includes("midday")) return 12;
  if (t.includes("afternoon")) return 15;
  if (t.includes("dusk") || t.includes("sunset") || t.includes("evening")) return 18;
  if (t.includes("night")) return 22;
  return -1;
}

function parseMinutes(time: string): number {
  const m = time.match(/\b\d{1,2}[:.h](\d{2})\b/);
  return m ? parseInt(m[1]!, 10) : 0;
}

function getTimePeriod(time: string): string | null {
  const t = time.toLowerCase();
  if (t.includes("night") || t.includes("midnight")) return "Night";
  if (t.includes("dawn") || t.includes("sunrise")) return "Dawn";
  if (t.includes("morning")) return "Morning";
  if (t.includes("noon") || t.includes("midday")) return "Midday";
  if (t.includes("afternoon")) return "Afternoon";
  if (t.includes("dusk") || t.includes("sunset")) return "Dusk";
  if (t.includes("evening")) return "Evening";
  return null;
}

function getWeatherEmoji(weather: string): string {
  const w = weather.toLowerCase();
  if (w.includes("thunder") || w.includes("lightning")) return "⛈️";
  if (w.includes("blizzard")) return "🌨️";
  if (w.includes("heavy rain") || w.includes("downpour") || w.includes("storm")) return "🌧️";
  if (w.includes("rain") || w.includes("drizzle") || w.includes("shower")) return "🌦️";
  if (w.includes("hail")) return "🧊";
  if (w.includes("snow") || w.includes("sleet") || w.includes("frost")) return "❄️";
  if (w.includes("fog") || w.includes("mist") || w.includes("haze")) return "🌫️";
  if (w.includes("sand") || w.includes("dust")) return "🏜️";
  if (w.includes("ash") || w.includes("volcanic") || w.includes("smoke")) return "🌋";
  if (w.includes("ember") || w.includes("fire") || w.includes("inferno")) return "🔥";
  if (w.includes("wind") || w.includes("breez") || w.includes("gust")) return "💨";
  if (w.includes("cherry") || w.includes("blossom") || w.includes("petal")) return "🌸";
  if (w.includes("aurora") || w.includes("northern light")) return "🌌";
  if (w.includes("cloud") || w.includes("overcast") || w.includes("grey") || w.includes("gray")) return "☁️";
  if (w.includes("clear") || w.includes("sunny") || w.includes("bright")) return "☀️";
  if (w.includes("hot") || w.includes("swelter")) return "🥵";
  if (w.includes("cold") || w.includes("freez")) return "🥶";
  return "🌤️";
}

function parseTemperature(temp: string): number | null {
  const m = temp.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const num = parseFloat(m[0]!);
  if (/°?\s*f/i.test(temp)) return Math.round((num - 32) * (5 / 9));
  return Math.round(num);
}

/** Map descriptive temperature words to a numeric-equivalent hint (°C). */
function getTemperatureKeywordHint(text: string): number | null {
  const t = text.toLowerCase();
  if (/\b(freez|frigid|arctic|glacial|sub-?zero|blizzard)/.test(t)) return -10;
  if (/\b(cold|chill|frost|wintry|icy|bitter|nipp)/.test(t)) return 2;
  if (/\b(cool|brisk|crisp|refresh)/.test(t)) return 12;
  if (/\b(mild|pleasant|comfort|temperate|fair)/.test(t)) return 20;
  if (/\b(warm|balmy|toasty|muggy|humid|stuffy|sultry)/.test(t)) return 28;
  if (/\b(hot|swelter|blaz|scorch|burn|heat|boil|sear|bak)/.test(t)) return 38;
  return null;
}

/** Categorise location text into a colour for the map-pin icon. */
function getLocationPinColor(location: string): string {
  const l = location.toLowerCase();
  // Water
  if (
    /\b(sea|ocean|lake|river|pond|creek|bay|shore|beach|harbor|harbour|port|coast|marsh|swamp|waterfall|spring|well|dock|canal|dam|reef|lagoon|estuary|fjord|cove)\b/.test(
      l,
    )
  )
    return "text-blue-400";
  // Mountains / rocky terrain
  if (
    /\b(mountain|hill|cliff|peak|ridge|canyon|gorge|cave|cavern|mine|quarry|summit|bluff|crag|volcano|crater|mesa|plateau|ravine|boulder)\b/.test(
      l,
    )
  )
    return "text-amber-700";
  // Urban / city
  if (
    /\b(city|town|village|castle|palace|fortress|market|shop|inn|tavern|bar|pub|guild|district|quarter|bazaar|temple|church|cathedral|shrine|tower|gate|square|plaza|street|alley|arena|throne|court|capitol|capital|metro|subway)\b/.test(
      l,
    )
  )
    return "text-purple-400";
  // Interior / indoors
  if (
    /\b(room|hall|chamber|dungeon|cellar|basement|attic|library|study|bedroom|kitchen|office|lab|laboratory|vault|corridor|passage|cabin|hut|tent|interior|house|home|building|apartment|manor|lodge|dormitor|warehouse|prison|cell|jail)\b/.test(
      l,
    )
  )
    return "text-amber-300";
  // Nature / forest / fields (broadest — checked last)
  if (
    /\b(forest|wood|grove|jungle|garden|park|field|meadow|glade|clearing|plain|prairie|steppe|savanna|farm|ranch|orchard|vineyard|glen|vale|valley|thicket|copse|heath|moor|desert|tundra|waste|wild|trail|path|road)\b/.test(
      l,
    )
  )
    return "text-emerald-400";
  // Default — the base emerald
  return "text-emerald-400";
}
