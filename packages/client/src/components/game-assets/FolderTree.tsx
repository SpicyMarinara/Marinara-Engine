// ──────────────────────────────────────────────
// File Browser — Folder Tree (sidebar)
// ──────────────────────────────────────────────
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
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
}: FolderTreeProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = !!(node.children && node.children.length > 0);
  const isRoot = depth === 0;

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
            aria-label={isExpanded ? `Collapse ${isRoot ? "Game Assets" : node.name}` : `Expand ${isRoot ? "Game Assets" : node.name}`}
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
            />
          ))}
    </div>
  );
}
