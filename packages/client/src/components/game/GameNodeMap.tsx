// ──────────────────────────────────────────────
// Game: Node Map (dungeons/interiors)
// ──────────────────────────────────────────────
import { useState, useCallback, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { GameMap } from "@marinara-engine/shared";

interface GameNodeMapProps {
  map: GameMap;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId?: string | null;
  /** When true, node clicks are disabled (e.g. narration still playing) */
  disabled?: boolean;
  showPartyPosition?: boolean;
  zoom?: number;
  topLeftAction?: ReactNode;
  topRightAction?: ReactNode;
}

export function GameNodeMap({
  map,
  onNodeClick,
  selectedNodeId,
  disabled,
  showPartyPosition = true,
  zoom = 1,
  topLeftAction,
  topRightAction,
}: GameNodeMapProps) {
  const nodes = map.nodes || [];
  const edges = map.edges || [];
  const currentNodeId = showPartyPosition && typeof map.partyPosition === "string" ? map.partyPosition : null;
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
  const zoomOutScale = Math.min(zoom, 1);
  const visibleViewWidth = viewWidth / zoomOutScale;
  const visibleViewHeight = viewHeight / zoomOutScale;
  const centerX = minX + viewWidth / 2;
  const centerY = minY + viewHeight / 2;
  const visibleMinX = centerX - visibleViewWidth / 2;
  const visibleMinY = centerY - visibleViewHeight / 2;
  const mapContentWidth = `${Math.max(zoom, 1) * 100}%`;

  // Build adjacency for current node highlighting
  const adjacentIds = new Set<string>();
  for (const edge of edges) {
    if (edge.from === currentNodeId) adjacentIds.add(edge.to);
    if (edge.to === currentNodeId) adjacentIds.add(edge.from);
  }

  const visualScale = Math.pow(Math.max(zoom, 1), -1.12);
  const edgeStrokeWidth = 2 * visualScale;
  const nodeRadius = 16 * visualScale;
  const emojiFontSize = 12 * visualScale;
  const tooltipWidth = 80 * visualScale;
  const tooltipHeight = 16 * visualScale;
  const tooltipRadius = 4 * visualScale;
  const tooltipLabelOffset = 22 * visualScale;
  const tooltipTopOffset = 32 * visualScale;
  const tooltipFontSize = 7 * visualScale;

  return (
    <div className="relative" onMouseLeave={() => setHoveredNodeId(null)}>
      {topLeftAction}
      {topRightAction}
      <div
        className="w-full overflow-auto rounded"
        style={{
          aspectRatio: `${viewWidth} / ${viewHeight}`,
          maxHeight: "min(52vh, 340px)",
        }}
      >
        <svg
          viewBox={`${visibleMinX} ${visibleMinY} ${visibleViewWidth} ${visibleViewHeight}`}
          className="block rounded border border-[var(--border)] bg-gray-900/30"
          style={{ width: mapContentWidth }}
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
                strokeWidth={edgeStrokeWidth}
                strokeDasharray={isTraversed ? "none" : "4 4"}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isCurrent = node.id === currentNodeId;
            const isSelected = node.id === selectedNodeId;
            const isAdjacent = adjacentIds.has(node.id);
            const isDiscovered = !!node.discovered;
            const isClickable = !disabled && (isCurrent || isAdjacent || isDiscovered);
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
                  r={nodeRadius}
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
                    isCurrent
                      ? "#ffffff"
                      : isSelected
                        ? "#38bdf8"
                        : isAdjacent && !disabled
                          ? "#a8a29e"
                          : isDiscovered && !disabled
                            ? "rgba(148, 163, 184, 0.45)"
                            : "transparent"
                  }
                  strokeWidth={(isCurrent || isSelected ? 2 : 1) * visualScale}
                />
                {/* Emoji */}
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={emojiFontSize}
                  className="pointer-events-none"
                >
                  {node.discovered ? node.emoji : "❓"}
                </text>
                {/* Tooltip label — shown on hover/tap only */}
                {node.discovered && isHovered && (
                  <>
                    <rect
                      x={node.x - tooltipWidth / 2}
                      y={node.y - tooltipTopOffset}
                      width={tooltipWidth}
                      height={tooltipHeight}
                      rx={tooltipRadius}
                      fill="rgba(0, 0, 0, 0.85)"
                      stroke="rgba(255, 255, 255, 0.15)"
                      strokeWidth={0.5 * visualScale}
                      className="pointer-events-none"
                    />
                    <text
                      x={node.x}
                      y={node.y - tooltipLabelOffset}
                      textAnchor="middle"
                      fontSize={tooltipFontSize}
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
    </div>
  );
}
