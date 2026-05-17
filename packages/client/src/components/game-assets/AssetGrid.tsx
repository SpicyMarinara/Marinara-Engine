// ──────────────────────────────────────────────
// File Browser — Asset grid / list view (with multi-select checkboxes)
// ──────────────────────────────────────────────
import { Check, Folder, FolderOpen, Minus, MoreHorizontal } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import type { GameAssetSelectionStatus } from "../../lib/game-asset-selection";
import { formatBytes, formatDate } from "../../lib/format";
import { CATEGORY_ICONS } from "./constants";
import { FileIcon, isImage } from "./utils";
import { encodeAssetPath } from "./encode-asset-path";

/**
 * Props for the AssetGrid component.
 */
export interface AssetGridProps {
  /** Nodes to render in the current folder */
  nodes: TreeNode[];
  /** Current display mode */
  viewMode: "grid" | "list";
  /** Set of selected file paths */
  selectedPaths: Set<string>;
  /** Toggle selection of a single node */
  onToggleSelect: (node: TreeNode) => void;
  /** Open context menu on right-click */
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  /** Open/preview a file */
  onSelectFile: (node: TreeNode) => void;
  /** Navigate into a folder */
  onNavigateFolder: (path: string) => void;
  /** Open the 3-dot action menu */
  onOpenActionMenu: (node: TreeNode, anchorEl: HTMLElement) => void;
  /** Which optional list columns are visible */
  listColumns: { size: boolean; modified: boolean };
  /** Show per-game folder inclusion controls */
  assetSelectionMode?: boolean;
  /** Resolve the inclusion status for a folder */
  getFolderSelectionStatus?: (node: TreeNode) => GameAssetSelectionStatus;
  /** Open the per-game folder selection menu */
  onOpenFolderSelection?: (node: TreeNode, anchorEl: HTMLElement) => void;
}

/**
 * Select a static Tailwind grid-template-columns class for the list view.
 *
 * @param listColumns - Visibility flags for size and modified columns
 * @returns Tailwind class like "grid-cols-[2rem_auto_1fr_80px_40px]"
 */
function listGridCols(listColumns: { size: boolean; modified: boolean }): string {
  if (listColumns.size && listColumns.modified) {
    return "grid-cols-[2rem_auto_1fr_80px_80px_40px]";
  }
  if (listColumns.size || listColumns.modified) {
    return "grid-cols-[2rem_auto_1fr_80px_40px]";
  }
  return "grid-cols-[2rem_auto_1fr_40px]";
}

function FolderSelectionMark({ status }: { status: GameAssetSelectionStatus }) {
  if (status === "included") return <Check size="0.75rem" />;
  if (status === "partial") return <Minus size="0.75rem" />;
  return null;
}

/**
 * Render a grid or list of asset nodes with multi-select checkboxes.
 *
 * @param props - See {@link AssetGridProps}
 */
export function AssetGrid({
  nodes,
  viewMode,
  selectedPaths,
  onToggleSelect,
  onContextMenu,
  onSelectFile,
  onNavigateFolder,
  onOpenActionMenu,
  listColumns,
  assetSelectionMode = false,
  getFolderSelectionStatus,
  onOpenFolderSelection,
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

  const gridColsClass = listGridCols(listColumns);

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(clamp(6.75rem,18vmin,10rem),1fr))] gap-[clamp(0.5rem,1.4vmin,0.875rem)] p-[clamp(0.5rem,1.6vmin,0.875rem)]">
        {nodes.map((node) => {
          const isSelected = selectedPaths.has(node.path);
          const isFile = node.type === "file";
          const folderSelectionStatus =
            !isFile && assetSelectionMode ? (getFolderSelectionStatus?.(node) ?? "included") : null;
          return (
            <div
              key={node.path}
              onContextMenu={(e) => onContextMenu(e, node)}
              onClick={() => {
                if (node.type === "folder") onNavigateFolder(node.path);
                else onSelectFile(node);
              }}
              className={
                "group relative flex flex-col items-center gap-2 rounded-xl border bg-[var(--card)] p-[clamp(0.5rem,1.3vmin,0.875rem)] transition-all hover:border-[var(--primary)]/30 hover:shadow-sm " +
                (isSelected ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/30" : "border-[var(--border)]")
              }
            >
              {/* Checkbox — files only, always visible */}
              {isFile && (
                <label
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-[var(--background)] shadow-sm transition-colors hover:border-[var(--primary)]"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(node)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                </label>
              )}
              {folderSelectionStatus && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFolderSelection?.(node, e.currentTarget);
                  }}
                  className={
                    "absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-colors " +
                    (folderSelectionStatus === "excluded"
                      ? "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                      : "border-[var(--primary)]/40 bg-[var(--primary)] text-white hover:opacity-90")
                  }
                  title="Select assets for this game"
                  aria-label={`Select ${node.name} assets for this game`}
                >
                  <FolderSelectionMark status={folderSelectionStatus} />
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenActionMenu(node, e.currentTarget);
                }}
                className="absolute right-1.5 top-1.5 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <MoreHorizontal size="0.875rem" />
              </button>

              <div className="flex aspect-square w-[clamp(3.5rem,13vmin,6.75rem)] max-w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)]">
                {node.type === "folder" ? (
                  (() => {
                    const CategoryIcon = CATEGORY_ICONS[node.name] || Folder;
                    return (
                      <CategoryIcon className="h-[52%] min-h-8 w-[52%] min-w-8 max-h-16 max-w-16 text-[var(--primary)]" />
                    );
                  })()
                ) : isImage(node.ext) ? (
                  <img
                    src={`/api/game-assets/file/${encodeAssetPath(node.path)}`}
                    alt={node.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon ext={node.ext} className="h-8 w-8 text-[var(--primary)]" />
                )}
              </div>
              <span className="w-full truncate text-center text-xs text-[var(--foreground)]">{node.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col">
      <div
        className={`grid ${gridColsClass} items-center gap-3 border-b border-[var(--border)]/40 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)]`}
      >
        <span></span>
        <span className="col-span-2">Name</span>
        {listColumns.size && <span className="text-right">Size</span>}
        {listColumns.modified && <span className="text-right">Modified</span>}
        <span></span>
      </div>
      {nodes.map((node) => {
        const isSelected = selectedPaths.has(node.path);
        const isFile = node.type === "file";
        const folderSelectionStatus =
          !isFile && assetSelectionMode ? (getFolderSelectionStatus?.(node) ?? "included") : null;
        return (
          <div
            key={node.path}
            onContextMenu={(e) => onContextMenu(e, node)}
            onClick={() => {
              if (node.type === "folder") onNavigateFolder(node.path);
              else onSelectFile(node);
            }}
            className={
              `group grid ${gridColsClass} items-center gap-3 rounded-lg px-3 py-2 transition-colors ` +
              (isSelected ? "bg-[var(--primary)]/10" : "hover:bg-[var(--accent)]")
            }
          >
            {/* Checkbox — files only */}
            <div onClick={(e) => e.stopPropagation()} className="flex items-center">
              {isFile && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(node)}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
                />
              )}
              {folderSelectionStatus && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFolderSelection?.(node, e.currentTarget);
                  }}
                  className={
                    "flex h-5 w-5 items-center justify-center rounded-full border transition-colors " +
                    (folderSelectionStatus === "excluded"
                      ? "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                      : "border-[var(--primary)]/40 bg-[var(--primary)] text-white hover:opacity-90")
                  }
                  title="Select assets for this game"
                  aria-label={`Select ${node.name} assets for this game`}
                >
                  <FolderSelectionMark status={folderSelectionStatus} />
                </button>
              )}
            </div>

            {node.type === "folder" ? (
              (() => {
                const CategoryIcon = CATEGORY_ICONS[node.name] || Folder;
                return <CategoryIcon size="1rem" className="shrink-0 text-[var(--primary)]" />;
              })()
            ) : isImage(node.ext) ? (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--accent)]">
                <img
                  src={`/api/game-assets/file/${encodeAssetPath(node.path)}`}
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
              <span className="text-right text-xs text-[var(--muted-foreground)]">{formatBytes(node.size)}</span>
            )}
            {listColumns.modified && (
              <span className="text-right text-xs text-[var(--muted-foreground)]">{formatDate(node.modified)}</span>
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
        );
      })}
    </div>
  );
}
