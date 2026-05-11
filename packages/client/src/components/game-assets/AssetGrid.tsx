// ──────────────────────────────────────────────
// File Browser — Asset grid / list view
// ──────────────────────────────────────────────
import { Folder, FolderOpen, MoreHorizontal } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import { formatBytes, formatDate } from "../../lib/format";
import { CATEGORY_ICONS } from "./constants";
import { FileIcon, isImage } from "./utils";

export interface AssetGridProps {
  nodes: TreeNode[];
  viewMode: "grid" | "list";
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onSelectFile: (node: TreeNode) => void;
  onNavigateFolder: (path: string) => void;
  onOpenActionMenu: (node: TreeNode, anchorEl: HTMLElement) => void;
  listColumns: { size: boolean; modified: boolean };
}

export function AssetGrid({
  nodes,
  viewMode,
  onContextMenu,
  onSelectFile,
  onNavigateFolder,
  onOpenActionMenu,
  listColumns,
}: AssetGridProps) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-8 text-[var(--muted-foreground)]">
        <FolderOpen size="2rem" className="opacity-40" />
        <p className="text-sm">This folder is empty</p>
        <p className="text-xs opacity-60">Drop files here to upload</p>
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {nodes.map((node) => (
          <div
            key={node.path}
            onContextMenu={(e) => onContextMenu(e, node)}
            onClick={() => {
              if (node.type === "folder") onNavigateFolder(node.path);
              else onSelectFile(node);
            }}
            className="group relative flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition-all hover:border-[var(--primary)]/30 hover:shadow-sm"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenActionMenu(node, e.currentTarget);
              }}
              className="absolute right-1.5 top-1.5 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <MoreHorizontal size="0.875rem" />
            </button>

            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)]">
              {node.type === "folder" ? (
                (() => {
                  const CategoryIcon = CATEGORY_ICONS[node.name] || Folder;
                  return <CategoryIcon size="2.5rem" className="text-[var(--primary)]" />;
                })()
              ) : isImage(node.ext) ? (
                <img
                  src={`/api/game-assets/file/${node.path}`}
                  alt={node.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <FileIcon ext={node.ext} className="h-8 w-8 text-[var(--primary)]" />
              )}
            </div>
            <span className="w-full truncate text-center text-xs text-[var(--foreground)]">
              {node.name}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[auto_1fr_80px_80px_40px] items-center gap-3 border-b border-[var(--border)]/40 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        <span className="col-span-2">Name</span>
        {listColumns.size && <span className="text-right">Size</span>}
        {listColumns.modified && <span className="text-right">Modified</span>}
        <span></span>
      </div>
      {nodes.map((node) => (
        <div
          key={node.path}
          onContextMenu={(e) => onContextMenu(e, node)}
          onClick={() => {
            if (node.type === "folder") onNavigateFolder(node.path);
            else onSelectFile(node);
          }}
          className="group grid grid-cols-[auto_1fr_80px_80px_40px] items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--accent)]"
        >
          {node.type === "folder" ? (
            (() => {
              const CategoryIcon = CATEGORY_ICONS[node.name] || Folder;
              return <CategoryIcon size="1rem" className="shrink-0 text-[var(--primary)]" />;
            })()
          ) : isImage(node.ext) ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--accent)]">
              <img
                src={`/api/game-assets/file/${node.path}`}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <FileIcon ext={node.ext} className="shrink-0 text-[var(--muted-foreground)]" size="1rem" />
          )}
          <span className="truncate text-sm text-[var(--foreground)]">{node.name}</span>
          {listColumns.size && (
            <span className="text-right text-xs text-[var(--muted-foreground)]">
              {formatBytes(node.size)}
            </span>
          )}
          {listColumns.modified && (
            <span className="text-right text-xs text-[var(--muted-foreground)]">
              {formatDate(node.modified)}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenActionMenu(node, e.currentTarget);
            }}
            className="justify-self-end rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <MoreHorizontal size="0.875rem" />
          </button>
        </div>
      ))}
    </div>
  );
}
