// ──────────────────────────────────────────────
// File Browser — Folder Tree (sidebar)
// ──────────────────────────────────────────────
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import { cn } from "../../lib/utils";
import { CATEGORY_ICONS } from "./constants";

export interface FolderTreeProps {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

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
            onClick={() => onToggle(node.path)}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            {isExpanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
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
