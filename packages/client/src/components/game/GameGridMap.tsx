// ──────────────────────────────────────────────
// Game: Grid Map (overworld/city)
// ──────────────────────────────────────────────
import { cn } from "../../lib/utils";
import type { GridCell, GameMap } from "@marinara-engine/shared";
import { AnimatedText } from "./AnimatedText";

const TERRAIN_COLORS: Record<string, string> = {
  grass: "bg-green-900/40",
  forest: "bg-green-800/50",
  water: "bg-blue-900/50",
  mountain: "bg-stone-700/60",
  desert: "bg-amber-900/40",
  snow: "bg-slate-300/20",
  town: "bg-yellow-900/30",
  dungeon: "bg-purple-900/40",
  road: "bg-stone-600/30",
  cave: "bg-gray-800/60",
};

interface GameGridMapProps {
  map: GameMap;
  onCellClick: (x: number, y: number) => void;
  selectedPosition?: { x: number; y: number } | string | null;
  disabled?: boolean;
}

export function GameGridMap({ map, onCellClick, selectedPosition, disabled }: GameGridMapProps) {
  const cells = map.cells || [];
  const width = map.width || 5;
  const height = map.height || 5;
  const partyPos = typeof map.partyPosition === "object" ? map.partyPosition : null;
  const selectedCell = typeof selectedPosition === "object" ? selectedPosition : null;

  // Build a lookup from (x,y) to cell
  const cellMap = new Map<string, GridCell>();
  for (const c of cells) {
    cellMap.set(`${c.x},${c.y}`, c);
  }

  // Adjacent cells to party (valid movement targets)
  const adjacentSet = new Set<string>();
  if (partyPos) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        adjacentSet.add(`${partyPos.x + dx},${partyPos.y + dy}`);
      }
    }
  }

  const rows: GridCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(
        cellMap.get(`${x},${y}`) ?? {
          x,
          y,
          emoji: "❓",
          label: "Unknown",
          discovered: false,
          terrain: "",
          description: "",
        },
      );
    }
    rows.push(row);
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--foreground)]">{map.name}</span>
        <AnimatedText html={map.description || ""} className="text-xs text-[var(--muted-foreground)]" />
      </div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` }}>
        {rows.map((row) =>
          row.map((cell) => {
            const isParty = partyPos && partyPos.x === cell.x && partyPos.y === cell.y;
            const isSelected = selectedCell && selectedCell.x === cell.x && selectedCell.y === cell.y;
            const isAdjacent = adjacentSet.has(`${cell.x},${cell.y}`);
            const isMovable = !disabled && isAdjacent && cell.discovered;
            const terrainBg = TERRAIN_COLORS[cell.terrain] || "bg-gray-800/40";

            return (
              <button
                key={`${cell.x},${cell.y}`}
                onClick={() => isMovable && onCellClick(cell.x, cell.y)}
                disabled={!isMovable}
                title={
                  cell.discovered
                    ? `${cell.label}: ${cell.description || cell.terrain}${isMovable ? " (click to select)" : ""}`
                    : "Undiscovered"
                }
                className={cn(
                  "relative flex aspect-square items-center justify-center rounded text-base transition-all",
                  cell.discovered ? terrainBg : "bg-gray-900/70 game-map-fog",
                  isParty && "ring-2 ring-amber-400 ring-offset-1 ring-offset-[var(--card)]",
                  isSelected && !isParty && "ring-2 ring-sky-400/70 ring-offset-1 ring-offset-[var(--card)]",
                  isMovable && "hover:brightness-125 cursor-pointer ring-1 ring-amber-400/30",
                  !isMovable && "cursor-default opacity-80",
                )}
              >
                {cell.discovered ? (
                  <>
                    <span className="text-sm">{cell.emoji}</span>
                    {isParty && (
                      <span className="absolute -bottom-0.5 -right-0.5 text-[10px] game-party-marker">📍</span>
                    )}
                  </>
                ) : (
                  <span className="text-sm opacity-50">❓</span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
