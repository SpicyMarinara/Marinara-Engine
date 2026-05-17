// ──────────────────────────────────────────────
// File Browser — Folder Tree (sidebar)
// ──────────────────────────────────────────────
import { Check, ChevronDown, ChevronRight, Folder, Minus } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import type { GameAssetSelectionStatus } from "../../lib/game-asset-selection";
import { cn } from "../../lib/utils";
import { CATEGORY_ICONS } from "./constants";

/**
 * Props for the FolderTree component.
 */
export interface FolderTreeProps {
  /** Tree node to render */
  node: TreeNode;
  /** Current nesting depth (0 = root) */
  depth: number;
  /** Currently selected folder path */
  selectedPath: string;
  /** Set of expanded folder paths */
  expanded: Set<string>;
  /** Toggle expand/collapse of a folder */
  onToggle: (path: string) => void;
  /** Select/navigate to a folder */
  onSelect: (path: string) => void;
  /** Show per-game folder inclusion controls */
  assetSelectionMode?: boolean;
  /** Resolve the inclusion status for a folder */
  getFolderSelectionStatus?: (node: TreeNode) => GameAssetSelectionStatus;
  /** Open the per-game folder selection menu */
  onOpenFolderSelection?: (node: TreeNode, anchorEl: HTMLElement) => void;
}

function FolderSelectionMark({ status }: { status: GameAssetSelectionStatus }) {
  if (status === "included") return <Check size="0.625rem" />;
  if (status === "partial") return <Minus size="0.625rem" />;
  return null;
}

/**
 * Recursive sidebar folder tree with chevron expand/collapse.
 *
 * @param props - See {@link FolderTreeProps}
 */
export function FolderTree({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
  assetSelectionMode = false,
  getFolderSelectionStatus,
  onOpenFolderSelection,
}: FolderTreeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = !!(node.children && node.children.length > 0);
  const isRoot = depth === 0;
  const selectionStatus = !isRoot && assetSelectionMode ? (getFolderSelectionStatus?.(node) ?? "included") : null;

  const CategoryIcon = isRoot ? Folder : CATEGORY_ICONS[node.name] || Folder;

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
          isSelected
            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
            : "text-[var(--foreground)] hover:bg-[var(--accent)]",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={
              isExpanded
                ? `Collapse ${isRoot ? "Game Assets" : node.name}`
                : `Expand ${isRoot ? "Game Assets" : node.name}`
            }
            aria-expanded={isExpanded}
            onClick={() => onToggle(node.path)}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            {isExpanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className="flex flex-1 items-center gap-1.5 overflow-hidden"
        >
          <CategoryIcon size="0.875rem" className="shrink-0" />
          <span className="truncate">{isRoot ? "Game Assets" : node.name}</span>
        </button>
        {selectionStatus && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolderSelection?.(node, e.currentTarget);
            }}
            className={
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors " +
              (selectionStatus === "excluded"
                ? "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                : "border-[var(--primary)]/40 bg-[var(--primary)] text-white hover:opacity-90")
            }
            title="Select assets for this game"
            aria-label={`Select ${node.name} assets for this game`}
          >
            <FolderSelectionMark status={selectionStatus} />
          </button>
        )}
      </div>
      {isExpanded &&
        hasChildren &&
        node
          .children!.filter((c) => c.type === "folder")
          .map((child) => (
            <FolderTree
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              assetSelectionMode={assetSelectionMode}
              getFolderSelectionStatus={getFolderSelectionStatus}
              onOpenFolderSelection={onOpenFolderSelection}
            />
          ))}
    </div>
  );
}
