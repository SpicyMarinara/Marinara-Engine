// ──────────────────────────────────────────────
// Game: Node Map (dungeons/interiors)
// ──────────────────────────────────────────────
import { useState, useCallback } from "react";
import { cn } from "../../lib/utils";
import type { GameMap } from "@marinara-engine/shared";

interface GameNodeMapProps {
  map: GameMap;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId?: string | null;
  /** When true, node clicks are disabled (e.g. narration still playing) */
  disabled?: boolean;
}

export function GameNodeMap({ map, onNodeClick, selectedNodeId, disabled }: GameNodeMapProps) {
  const nodes = map.nodes || [];
  const edges = map.edges || [];
  const currentNodeId = typeof map.partyPosition === "string" ? map.partyPosition : null;
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const handleTap = useCallback(
    (nodeId: string, isClickable: boolean) => {
      // On mobile: first tap shows tooltip, second tap navigates
      if (hoveredNodeId === nodeId && isClickable) {
        onNodeClick(nodeId);
      } else {
        setHoveredNodeId(nodeId);
      }
    },
    [hoveredNodeId, onNodeClick],
  );

  // Guard against empty nodes — no SVG to render
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center rounded border border-[var(--border)] bg-gray-900/30 p-4 text-xs text-[var(--muted-foreground)]">
        No map nodes available
      </div>
    );
  }

  // Calculate SVG bounds from node positions
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const padding = 40;
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  const viewWidth = maxX - minX || 200;
  const viewHeight = maxY - minY || 200;

  // Build adjacency for current node highlighting
  const adjacentIds = new Set<string>();
  for (const edge of edges) {
    if (edge.from === currentNodeId) adjacentIds.add(edge.to);
    if (edge.to === currentNodeId) adjacentIds.add(edge.from);
  }

  return (
    <div
      className="overflow-y-auto overflow-x-hidden"
      style={{ maxHeight: 220 }}
      onMouseLeave={() => setHoveredNodeId(null)}
    >
      <svg
        viewBox={`${minX} ${minY} ${viewWidth} ${viewHeight}`}
        className="w-full rounded border border-[var(--border)] bg-gray-900/30"
      >
        {/* Edges */}
        {edges.map((edge) => {
          const from = nodes.find((n) => n.id === edge.from);
          const to = nodes.find((n) => n.id === edge.to);
          if (!from || !to) return null;
          const isTraversed = from.discovered && to.discovered;
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={isTraversed ? "rgba(168, 162, 158, 0.5)" : "rgba(100, 100, 100, 0.2)"}
              strokeWidth={2}
              strokeDasharray={isTraversed ? "none" : "4 4"}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isCurrent = node.id === currentNodeId;
          const isSelected = node.id === selectedNodeId;
          const isAdjacent = adjacentIds.has(node.id);
          const isClickable = !disabled && (isCurrent || isAdjacent);
          const isHovered = hoveredNodeId === node.id;

          return (
            <g
              key={node.id}
              onClick={() => handleTap(node.id, isClickable)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              className={cn(isClickable && "cursor-pointer")}
            >
              {/* Background circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={16}
                fill={
                  isCurrent
                    ? "rgba(255, 255, 255, 0.2)"
                    : isSelected
                      ? "rgba(56, 189, 248, 0.18)"
                      : node.discovered
                        ? "rgba(100, 100, 100, 0.3)"
                        : "rgba(50, 50, 50, 0.4)"
                }
                stroke={
                  isCurrent ? "#ffffff" : isSelected ? "#38bdf8" : isAdjacent && !disabled ? "#a8a29e" : "transparent"
                }
                strokeWidth={isCurrent || isSelected ? 2 : 1}
              />
              {/* Emoji */}
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="12"
                className="pointer-events-none"
              >
                {node.discovered ? node.emoji : "❓"}
              </text>
              {/* Tooltip label — shown on hover/tap only */}
              {node.discovered && isHovered && (
                <>
                  <rect
                    x={node.x - 40}
                    y={node.y - 32}
                    width={80}
                    height={16}
                    rx={4}
                    fill="rgba(0, 0, 0, 0.85)"
                    stroke="rgba(255, 255, 255, 0.15)"
                    strokeWidth={0.5}
                    className="pointer-events-none"
                  />
                  <text
                    x={node.x}
                    y={node.y - 22}
                    textAnchor="middle"
                    fontSize="7"
                    fill="rgba(255, 255, 255, 0.9)"
                    className="pointer-events-none"
                  >
                    {node.label.length > 16 ? node.label.slice(0, 15) + "…" : node.label}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
