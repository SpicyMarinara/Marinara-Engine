// ──────────────────────────────────────────────
// Game: Map Wrapper (switches between grid and node)
// ──────────────────────────────────────────────
import { useState, useCallback } from "react";
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

interface GameMapProps {
  map: GameMap | null;
  onMove: (position: { x: number; y: number } | string) => void;
  onGenerateMap?: () => void;
  /** Disable interactive elements (e.g. during narration playback) */
  disabled?: boolean;
  /** Current game state — shown as icon left of the location name */
  gameState?: GameActiveState;
}

/** Desktop: inline collapsible panel. */
export function GameMapPanel({ map, onMove, onGenerateMap, disabled, gameState }: GameMapProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [stateHovered, setStateHovered] = useState(false);
  const { locked, toggleLocked, x, y, handleDragEnd } = useDraggablePanel("map");

  if (!map) {
    return (
      <div className="flex w-52 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/92 p-3 text-[var(--muted-foreground)] shadow-lg backdrop-blur-sm">
        <span className="text-[0.625rem]">No map yet</span>
        {onGenerateMap && (
          <button
            onClick={onGenerateMap}
            className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-2 py-1 text-[0.625rem] font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90"
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

  return (
    <motion.div
      drag={!locked}
      dragMomentum={false}
      dragElastic={0}
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
          <GameGridMap map={map} onCellClick={(x, y) => onMove({ x, y })} />
        ) : (
          <GameNodeMap map={map} onNodeClick={(nodeId) => onMove(nodeId)} disabled={disabled} />
        ))}
    </motion.div>
  );
}

// ── Mobile Map: Icon trigger + fullscreen modal ──

interface MobileMapButtonProps {
  map: GameMap | null;
  onMove: (position: { x: number; y: number } | string) => void;
  onGenerateMap?: () => void;
  disabled?: boolean;
  gameState?: GameActiveState;
}

/** Mobile-only: map icon button in top-left that opens a centered modal. */
export function MobileMapButton({ map, onMove, onGenerateMap, disabled, gameState }: MobileMapButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

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
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-white/80 shadow-lg backdrop-blur-md transition-colors active:bg-white/10"
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
                      className="flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)]"
                    >
                      <Wand2 size={12} />
                      Generate
                    </button>
                  )}
                </div>
              ) : map.type === "grid" ? (
                <GameGridMap
                  map={map}
                  onCellClick={(x, y) => {
                    onMove({ x, y });
                    setOpen(false);
                  }}
                />
              ) : (
                <GameNodeMap map={map} onNodeClick={handleNodeTap} disabled={disabled} />
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
                    Travel to
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
