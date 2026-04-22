// ──────────────────────────────────────────────
// Game: Map Wrapper (switches between grid and node)
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, type RefObject } from "react";
import { motion } from "framer-motion";
import type { GameMap, GameActiveState } from "@marinara-engine/shared";
import { GameGridMap } from "./GameGridMap";
import { GameNodeMap } from "./GameNodeMap";
import { ChevronDown, ChevronUp, Map as MapIcon, Wand2, X, Compass, MessageCircle, Swords, Moon } from "lucide-react";
import { cn } from "../../lib/utils";
import { PanelLockButton, useDraggablePanel } from "./DraggablePanel";

const STATE_CONFIG: Record<GameActiveState, { icon: typeof Compass; label: string; color: string }> = {
  exploration: { icon: Compass, label: "Exploration", color: "text-emerald-300" },
  dialogue: { icon: MessageCircle, label: "Dialogue", color: "text-sky-300" },
  combat: { icon: Swords, label: "Combat", color: "text-red-300" },
  travel_rest: { icon: Moon, label: "Travel & Rest", color: "text-amber-300" },
};

type TimePhase = "midnight" | "night" | "dawn" | "morning" | "noon" | "afternoon" | "evening";

function extractHour(timeOfDay: string): number | null {
  const explicitTime = timeOfDay.match(/\b(\d{1,2})[:.h](\d{2})\b/);
  if (explicitTime) {
    let hour = Number.parseInt(explicitTime[1] ?? "", 10);
    if (timeOfDay.includes("pm") && hour < 12) hour += 12;
    if (timeOfDay.includes("am") && hour === 12) hour = 0;
    return hour >= 0 && hour < 24 ? hour : null;
  }

  const amPmTime = timeOfDay.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (amPmTime) {
    let hour = Number.parseInt(amPmTime[1] ?? "", 10);
    if (amPmTime[2] === "pm" && hour < 12) hour += 12;
    if (amPmTime[2] === "am" && hour === 12) hour = 0;
    return hour >= 0 && hour < 24 ? hour : null;
  }

  return null;
}

function normalizeTimePhase(timeOfDay?: string | null): TimePhase | null {
  if (!timeOfDay) return null;
  const normalized = timeOfDay.toLowerCase();

  if (normalized.includes("midnight")) return "midnight";
  if (normalized.includes("dawn") || normalized.includes("sunrise")) return "dawn";
  if (normalized.includes("morning")) return "morning";
  if (normalized.includes("noon") || normalized.includes("midday")) return "noon";
  if (normalized.includes("afternoon")) return "afternoon";
  if (normalized.includes("evening") || normalized.includes("dusk") || normalized.includes("sunset")) {
    return "evening";
  }
  if (normalized.includes("night")) return "night";

  const hour = extractHour(normalized);
  if (hour == null) return null;
  if (hour < 5) return "midnight";
  if (hour < 7) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 15) return "noon";
  if (hour < 18) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function getTimePhaseLabel(phase: TimePhase): string {
  switch (phase) {
    case "midnight":
      return "Midnight";
    case "night":
      return "Night";
    case "dawn":
      return "Dawn";
    case "morning":
      return "Morning";
    case "noon":
      return "Noon";
    case "afternoon":
      return "Afternoon";
    case "evening":
      return "Evening";
  }
}

function getSkyClasses(phase: TimePhase): string {
  switch (phase) {
    case "midnight":
      return "bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-900";
    case "night":
      return "bg-gradient-to-b from-slate-800 via-indigo-900 to-slate-950";
    case "dawn":
      return "bg-gradient-to-b from-rose-300 via-amber-200 to-sky-300";
    case "morning":
      return "bg-gradient-to-b from-sky-300 via-sky-200 to-amber-100";
    case "noon":
      return "bg-gradient-to-b from-sky-400 via-sky-300 to-sky-200";
    case "afternoon":
      return "bg-gradient-to-b from-sky-400 via-cyan-300 to-amber-100";
    case "evening":
      return "bg-gradient-to-b from-violet-400 via-rose-300 to-amber-200";
  }
}

function getOrbPosition(phase: TimePhase): string {
  switch (phase) {
    case "midnight":
      return "left-1/2 top-[1px] -translate-x-1/2";
    case "night":
      return "right-[16%] top-[1px]";
    case "dawn":
      return "left-[12%] bottom-[1px]";
    case "morning":
      return "left-[26%] bottom-[1px]";
    case "noon":
      return "left-1/2 top-[1px] -translate-x-1/2";
    case "afternoon":
      return "right-[24%] bottom-[1px]";
    case "evening":
      return "right-[10%] bottom-[1px]";
  }
}

interface TimeOfDayIndicatorProps {
  timeOfDay?: string | null;
  size?: "desktop" | "mobile";
  className?: string;
}

function TimeOfDayIndicator({ timeOfDay, size = "desktop", className }: TimeOfDayIndicatorProps) {
  const phase = normalizeTimePhase(timeOfDay);
  if (!phase) return null;

  const label = getTimePhaseLabel(phase);
  const nightPhase = phase === "night" || phase === "midnight";

  return (
    <span
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border border-white/20 shadow-[0_2px_8px_rgba(0,0,0,0.24)]",
        size === "mobile" ? "h-3.5 w-6" : "h-4 w-7",
        getSkyClasses(phase),
        className,
      )}
      aria-label={`Time of day: ${label}`}
      title={`Time of day: ${label}`}
    >
      <span className="absolute inset-x-[12%] bottom-[2px] h-px bg-white/45" />
      {nightPhase && (
        <>
          <span className="absolute left-[18%] top-[22%] h-[1.5px] w-[1.5px] rounded-full bg-white/80" />
          <span className="absolute right-[22%] top-[30%] h-px w-px rounded-full bg-white/70" />
        </>
      )}
      <span
        className={cn(
          "absolute rounded-full",
          size === "mobile" ? "h-2 w-2" : "h-2.5 w-2.5",
          getOrbPosition(phase),
          nightPhase
            ? "bg-slate-100 shadow-[0_0_8px_rgba(226,232,240,0.45)]"
            : phase === "evening"
              ? "bg-orange-200 shadow-[0_0_10px_rgba(251,146,60,0.55)]"
              : "bg-yellow-200 shadow-[0_0_10px_rgba(253,224,71,0.55)]",
        )}
      >
        {nightPhase && <span className="absolute inset-y-0 right-[-1px] w-[55%] rounded-full bg-slate-900/85" />}
      </span>
    </span>
  );
}

interface GameMapProps {
  map: GameMap | null;
  onMove: (position: { x: number; y: number } | string) => void;
  selectedPosition?: { x: number; y: number } | string | null;
  onGenerateMap?: () => void;
  /** Disable interactive elements (e.g. during narration playback) */
  disabled?: boolean;
  /** Current game state — shown as icon left of the location name */
  gameState?: GameActiveState;
  /** Current time of day — shown as a compact sky indicator. */
  timeOfDay?: string | null;
}

interface GameMapPanelProps extends GameMapProps {
  /** Chat id used to scope persisted lock + position so layouts don't bleed across games. */
  chatId: string;
  /** Ref to the game surface element used as a drag boundary. */
  constraintsRef?: RefObject<HTMLElement | null>;
}

/** Desktop: inline collapsible panel. */
export function GameMapPanel({
  map,
  onMove,
  selectedPosition,
  onGenerateMap,
  disabled,
  gameState,
  timeOfDay,
  chatId,
  constraintsRef,
}: GameMapPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [stateHovered, setStateHovered] = useState(false);
  const { locked, toggleLocked, x, y, handleDragEnd } = useDraggablePanel(chatId, "map");

  if (!map) {
    return (
      <div
        data-tour="game-map"
        className="flex w-52 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/92 p-3 text-[var(--muted-foreground)] shadow-lg backdrop-blur-sm"
      >
        <span className="text-[0.625rem]">No map yet</span>
        {onGenerateMap && (
          <button
            onClick={onGenerateMap}
            disabled={disabled}
            className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1 text-[0.625rem] font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50"
          >
            <Wand2 size={10} />
            Generate
          </button>
        )}
      </div>
    );
  }

  const mapName = map.name || "Map";
  const shouldMarquee = mapName.length > 18;
  const stateCfg = gameState ? STATE_CONFIG[gameState] : null;
  const StateIcon = stateCfg?.icon ?? null;
  const hasLeadingStatus = Boolean(StateIcon || timeOfDay);

  return (
    <motion.div
      data-tour="game-map"
      drag={!locked}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={constraintsRef as RefObject<Element>}
      onDragEnd={handleDragEnd}
      style={{ x, y }}
      className={cn(
        "game-map-container flex w-52 flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/92 p-2 shadow-lg backdrop-blur-sm",
        !locked && "cursor-grab ring-1 ring-white/20 active:cursor-grabbing",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(!collapsed);
          }
        }}
        className="relative flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        {hasLeadingStatus && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* State icon */}
            {StateIcon && (
              <span
                className={cn("relative shrink-0", stateCfg!.color)}
                onMouseEnter={() => setStateHovered(true)}
                onMouseLeave={() => setStateHovered(false)}
              >
                <StateIcon size={13} />
                {stateHovered && (
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[0.55rem] text-white/90 shadow z-50">
                    {stateCfg!.label}
                  </span>
                )}
              </span>
            )}
            <TimeOfDayIndicator timeOfDay={timeOfDay} />
          </div>
        )}
        <span className="block min-w-0 flex-1 overflow-hidden text-center font-semibold text-[var(--foreground)]">
          {shouldMarquee ? (
            <span className="game-map-marquee-track inline-flex whitespace-nowrap">
              <span className="pr-8">{mapName}</span>
              <span className="pr-8">{mapName}</span>
            </span>
          ) : (
            <span className="block truncate">{mapName}</span>
          )}
        </span>
        <PanelLockButton locked={locked} onToggle={toggleLocked} size={11} />
        <span className="shrink-0">{collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</span>
      </div>
      {!collapsed &&
        (map.type === "grid" ? (
          <GameGridMap
            map={map}
            onCellClick={(x, y) => onMove({ x, y })}
            selectedPosition={selectedPosition}
            disabled={disabled}
          />
        ) : (
          <GameNodeMap
            map={map}
            onNodeClick={(nodeId) => onMove(nodeId)}
            selectedNodeId={typeof selectedPosition === "string" ? selectedPosition : null}
            disabled={disabled}
          />
        ))}
    </motion.div>
  );
}

// ── Mobile Map: Icon trigger + fullscreen modal ──

interface MobileMapButtonProps {
  map: GameMap | null;
  onMove: (position: { x: number; y: number } | string) => void;
  selectedPosition?: { x: number; y: number } | string | null;
  onGenerateMap?: () => void;
  disabled?: boolean;
  gameState?: GameActiveState;
  timeOfDay?: string | null;
}

/** Mobile-only: map icon button in top-left that opens a centered modal. */
export function MobileMapButton({
  map,
  onMove,
  selectedPosition,
  onGenerateMap,
  disabled,
  gameState,
  timeOfDay,
}: MobileMapButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedNode(typeof selectedPosition === "string" ? selectedPosition : null);
  }, [open, selectedPosition]);

  const stateCfg = gameState ? STATE_CONFIG[gameState] : null;
  const StateIcon = stateCfg?.icon ?? Compass;

  const handleNodeTap = useCallback((nodeId: string) => {
    setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const handleTravel = useCallback(() => {
    if (selectedNode) {
      onMove(selectedNode);
      setSelectedNode(null);
      setOpen(false);
    }
  }, [selectedNode, onMove]);

  const currentNode = map?.nodes?.find(
    (n) => n.id === (typeof map.partyPosition === "string" ? map.partyPosition : null),
  );
  const selectedNodeData = map?.nodes?.find((n) => n.id === selectedNode);
  const adjacentIds = new Set<string>();
  if (map?.edges && currentNode) {
    for (const edge of map.edges) {
      if (edge.from === currentNode.id) adjacentIds.add(edge.to);
      if (edge.to === currentNode.id) adjacentIds.add(edge.from);
    }
  }
  const canTravel =
    !disabled && selectedNode != null && (adjacentIds.has(selectedNode) || selectedNode === currentNode?.id);

  return (
    <>
      {/* Floating map icon */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-white/80 shadow-lg backdrop-blur-md transition-colors active:bg-white/10"
      >
        <MapIcon size={18} />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => {
            setOpen(false);
            setSelectedNode(null);
          }}
        >
          <div
            className="relative flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-white/15 bg-[var(--card)]/95 shadow-2xl backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <StateIcon size={14} className={stateCfg?.color ?? "text-white/60"} />
              <TimeOfDayIndicator timeOfDay={timeOfDay} />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="block overflow-hidden whitespace-nowrap text-sm font-bold text-[var(--foreground)]">
                  {(map?.name || "Map").length > 18 ? (
                    <span className="game-map-marquee-track inline-flex whitespace-nowrap">
                      <span className="pr-8">{map?.name || "Map"}</span>
                      <span className="pr-8">{map?.name || "Map"}</span>
                    </span>
                  ) : (
                    <span className="block truncate">{map?.name || "Map"}</span>
                  )}
                </p>
                {currentNode && (
                  <p className="block overflow-hidden whitespace-nowrap text-[0.625rem] text-[var(--muted-foreground)]">
                    {currentNode.label.length > 22 ? (
                      <span className="game-map-marquee-track inline-flex whitespace-nowrap">
                        <span className="pr-8">📍 {currentNode.label}</span>
                        <span className="pr-8">📍 {currentNode.label}</span>
                      </span>
                    ) : (
                      <span className="block truncate">📍 {currentNode.label}</span>
                    )}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  setSelectedNode(null);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>

            {/* Map body */}
            <div className="flex-1 overflow-auto p-3">
              {!map ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-[var(--muted-foreground)]">
                  <span className="text-xs">No map yet</span>
                  {onGenerateMap && (
                    <button
                      onClick={() => {
                        onGenerateMap();
                        setOpen(false);
                      }}
                      disabled={disabled}
                      className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Wand2 size={12} />
                      Generate
                    </button>
                  )}
                </div>
              ) : map.type === "grid" ? (
                <GameGridMap
                  map={map}
                  selectedPosition={selectedPosition}
                  disabled={disabled}
                  onCellClick={(x, y) => {
                    onMove({ x, y });
                    setOpen(false);
                  }}
                />
              ) : (
                <GameNodeMap map={map} onNodeClick={handleNodeTap} selectedNodeId={selectedNode} disabled={disabled} />
              )}
            </div>

            {/* Selected node footer — shown when a node is tapped */}
            {selectedNodeData && selectedNodeData.discovered && (
              <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
                <span className="text-sm">{selectedNodeData.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">
                  {selectedNodeData.label}
                </span>
                {canTravel && selectedNode !== currentNode?.id && (
                  <button
                    onClick={handleTravel}
                    className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[0.6875rem] font-semibold text-[var(--primary-foreground)] transition-colors active:opacity-80"
                  >
                    Set destination
                  </button>
                )}
                {selectedNode === currentNode?.id && (
                  <span className="shrink-0 text-[0.625rem] text-emerald-400/70">You are here</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
