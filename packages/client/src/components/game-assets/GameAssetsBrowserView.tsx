// ──────────────────────────────────────────────
// View: File Browser (full-page overlay)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  FolderOpen,
  File,
  FileAudio,
  FileImage,
  FileText,
  Search,
  Grid3X3,
  List,
  Upload,
  Plus,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Music,
  Image,
  Volume2,
  Wind,
  Smile,
  MoreHorizontal,
  Pencil,
  Info,
  X,
  FilePlus,
} from "lucide-react";
import {
  useGameAssetTree,
  useCreateGameAssetFolder,
  useDeleteGameAssetFolder,
  useRenameGameAsset,
  useMoveGameAsset,
  useCopyGameAsset,
  useDeleteGameAsset,
  useOpenGameAssetsFolder,
  useRescanGameAssets,
  useUploadGameAsset,
  useUpdateFolderDescription,
  useGameAssetFileContent,
  useSaveGameAssetFile,
  useGameAssetFileInfo,
  type TreeNode,
} from "../../hooks/use-game-assets";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import { renderMarkdownBlocks, applyInlineMarkdown } from "../../lib/markdown";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  music: Music,
  sfx: Volume2,
  ambient: Wind,
  sprites: Smile,
  backgrounds: Image,
};

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  "": "Game assets folder — music, sfx, ambient audio, sprites, and backgrounds",
  music: "Background music for game states: exploration, dialogue, combat, travel/rest",
  sfx: "Sound effects for UI, combat, and exploration events",
  ambient: "Environmental background audio: nature, urban, interior",
  sprites: "Character and object sprites for visual novel / game modes",
  backgrounds: "Scene backgrounds for roleplay and game modes",
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]);
const EDITABLE_EXTS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".js", ".ts", ".tsx", ".css", ".html"]);

function isImage(ext?: string) {
  return IMAGE_EXTS.has(ext ?? "");
}

function isAudio(ext?: string) {
  return AUDIO_EXTS.has(ext ?? "");
}

function isEditableText(ext?: string) {
  return EDITABLE_EXTS.has(ext ?? "");
}

function formatBytes(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function FileIcon({ ext, className, size }: { ext?: string; className?: string; size?: string | number }) {
  if (isImage(ext)) {
    return <FileImage className={className} size={size} />;
  }
  if (isAudio(ext)) {
    return <FileAudio className={className} size={size} />;
  }
  return <File className={className} size={size} />;
}

function countItems(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((sum, child) => sum + countItems(child), 0);
}

// ════════════════════════════════════════════════
// Folder Tree
// ════════════════════════════════════════════════

function FolderTree({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = node.children && node.children.length > 0;
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
        node.children!.filter((c) => c.type === "folder").map((child) => (
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

// ════════════════════════════════════════════════
// Search Input (desktop always-visible, mobile expandable)
// ════════════════════════════════════════════════

function SearchInput({ search, onSearch }: { search: string; onSearch: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  // Desktop: always show input
  // Mobile: show icon button, expand to input when clicked
  return (
    <div className="relative ml-auto flex items-center">
      {/* Mobile collapsed state */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] sm:hidden"
          title="Search in folder"
        >
          <Search size="0.875rem" />
        </button>
      )}

      {/* Expanded input (mobile + desktop) */}
      <div className={cn("relative", !expanded && "hidden sm:block")}>
        <Search size="0.875rem" className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onBlur={() => { if (!search) setExpanded(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setExpanded(false); onSearch(""); } }}
          placeholder="Search in folder..."
          className="h-8 w-48 rounded-lg border border-[var(--border)] bg-[var(--background)] pl-7 pr-7 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 focus:ring-1 focus:ring-[var(--primary)]/20 max-sm:absolute max-sm:right-0 max-sm:top-1/2 max-sm:w-48 max-sm:-translate-y-1/2"
        />
        {expanded && (
          <button
            onClick={() => { setExpanded(false); onSearch(""); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] sm:hidden"
          >
            <X size="0.75rem" />
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Toolbar
// ════════════════════════════════════════════════

function Toolbar({
  breadcrumb,
  search,
  onSearch,
  viewMode,
  onViewMode,
  onUploadClick,
  onNewFolder,
  onNewTextFile,
  onNewMarkdownFile,
  onRescan,
  onOpenFolder,
  onBreadcrumbClick,
  listColumns,
  onToggleColumn,
}: {
  breadcrumb: string[];
  search: string;
  onSearch: (v: string) => void;
  viewMode: "grid" | "list";
  onViewMode: (v: "grid" | "list") => void;
  onUploadClick: () => void;
  onNewFolder: () => void;
  onNewTextFile: () => void;
  onNewMarkdownFile: () => void;
  onRescan: () => void;
  onOpenFolder: () => void;
  onBreadcrumbClick: (path: string) => void;
  listColumns: { size: boolean; modified: boolean };
  onToggleColumn: (col: "size" | "modified") => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const colsBtnRef = useRef<HTMLButtonElement>(null);
  const [newPos, setNewPos] = useState({ x: 0, y: 0 });
  const [colsPos, setColsPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handle = () => {
      if (newOpen) setNewOpen(false);
      if (colsOpen) setColsOpen(false);
    };
    if (newOpen || colsOpen) {
      requestAnimationFrame(() => document.addEventListener("mousedown", handle));
    }
    return () => document.removeEventListener("mousedown", handle);
  }, [newOpen, colsOpen]);

  const openNew = () => {
    const rect = newBtnRef.current?.getBoundingClientRect();
    if (rect) setNewPos({ x: rect.left, y: rect.bottom + 4 });
    setNewOpen(true);
  };

  const openCols = () => {
    const rect = colsBtnRef.current?.getBoundingClientRect();
    if (rect) setColsPos({ x: rect.left, y: rect.bottom + 4 });
    setColsOpen(true);
  };

  const dropdown = (
    open: boolean,
    pos: { x: number; y: number },
    children: React.ReactNode,
  ) =>
    open
      ? createPortal(
          <div
            className="fixed z-[60] min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
            style={{ left: pos.x, top: pos.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--border)]/40 bg-[var(--card)]/60 px-4 py-2 backdrop-blur-sm">
      {/* Breadcrumb — full width on mobile, side-scrollable */}
      <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm scrollbar-hide max-sm:w-full max-sm:flex-1">
        {breadcrumb.map((part, i) => {
          const isLast = i === breadcrumb.length - 1;
          const pathUpToHere = breadcrumb.slice(1, i + 1).filter(Boolean).join("/");
          return (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size="0.75rem" className="text-[var(--muted-foreground)]" />}
              {isLast ? (
                <span className="font-medium text-[var(--foreground)]">
                  {part || "Game Assets"}
                </span>
              ) : (
                <button
                  onClick={() => onBreadcrumbClick(pathUpToHere)}
                  className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  {part || "Game Assets"}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View mode */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
          <button
            onClick={() => onViewMode("grid")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              viewMode === "grid" ? "bg-[var(--accent)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            title="Grid view"
          >
            <Grid3X3 size="0.875rem" />
          </button>
          <button
            onClick={() => onViewMode("list")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              viewMode === "list" ? "bg-[var(--accent)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            title="List view"
          >
            <List size="0.875rem" />
          </button>
        </div>

        {/* Column toggle (list view only) */}
        {viewMode === "list" && (
          <>
            <button
              ref={colsBtnRef}
              onClick={openCols}
              className={cn(
                "rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]",
                colsOpen && "bg-[var(--accent)]",
              )}
              title="Columns"
            >
              <List size="0.875rem" />
            </button>
            {dropdown(
              colsOpen,
              colsPos,
              <>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]">
                  <input
                    type="checkbox"
                    checked={listColumns.size}
                    onChange={() => onToggleColumn("size")}
                    className="rounded border-[var(--border)]"
                  />
                  Size
                </label>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]">
                  <input
                    type="checkbox"
                    checked={listColumns.modified}
                    onChange={() => onToggleColumn("modified")}
                    className="rounded border-[var(--border)]"
                  />
                  Modified
                </label>
              </>,
            )}
          </>
        )}

        <button onClick={onUploadClick} className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
          <Upload size="0.875rem" />
          <span className="max-sm:hidden">Upload</span>
        </button>

        <button
          ref={newBtnRef}
          onClick={openNew}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]",
            newOpen && "bg-[var(--accent)]",
          )}
        >
          <Plus size="0.875rem" />
          <span className="max-sm:hidden">New</span>
        </button>
        {dropdown(
          newOpen,
          newPos,
          <>
            <button
              onClick={() => { onNewFolder(); setNewOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <Folder size="0.875rem" />
              New folder
            </button>
            <button
              onClick={() => { onNewTextFile(); setNewOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <FileText size="0.875rem" />
              New text file
            </button>
            <button
              onClick={() => { onNewMarkdownFile(); setNewOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <FilePlus size="0.875rem" />
              New markdown file
            </button>
          </>,
        )}

        <button onClick={onRescan} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]" title="Rescan">
          <RefreshCw size="0.875rem" />
        </button>
        <button onClick={onOpenFolder} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]" title="Open in system folder">
          <ExternalLink size="0.875rem" />
        </button>

        {/* Search */}
        <SearchInput search={search} onSearch={onSearch} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Action Dropdown (3-dot menu)
// ════════════════════════════════════════════════

function ActionDropdown({
  items,
  x,
  y,
  onClose,
}: {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useState(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    requestAnimationFrame(() => document.addEventListener("mousedown", handle));
    return () => document.removeEventListener("mousedown", handle);
  });

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
            item.disabled
              ? "cursor-not-allowed text-[var(--muted-foreground)] opacity-50"
              : item.destructive
                ? "text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                : "text-[var(--foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <span className="flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════
// Asset Grid
// ════════════════════════════════════════════════

function AssetGrid({
  nodes,
  viewMode,
  onContextMenu,
  onSelectFile,
  onNavigateFolder,
  onOpenActionMenu,
  listColumns,
}: {
  nodes: TreeNode[];
  viewMode: "grid" | "list";
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onSelectFile: (node: TreeNode) => void;
  onNavigateFolder: (path: string) => void;
  onOpenActionMenu: (node: TreeNode, anchorEl: HTMLElement) => void;
  listColumns: { size: boolean; modified: boolean };
}) {
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
              if (node.type === "folder") {
                onNavigateFolder(node.path);
              } else {
                onSelectFile(node);
              }
            }}
            className="group relative flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition-all hover:border-[var(--primary)]/30 hover:shadow-sm"
          >
            {/* 3-dot action button */}
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
            <span className="w-full truncate text-center text-xs text-[var(--foreground)]">{node.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* List header */}
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
            if (node.type === "folder") {
              onNavigateFolder(node.path);
            } else {
              onSelectFile(node);
            }
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
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════
// Image Preview Modal
// ════════════════════════════════════════════════

function ImagePreviewModal({
  node,
  onClose,
}: {
  node: TreeNode;
  onClose: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const { data: info } = useGameAssetFileInfo(node.path);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative flex max-h-[90vh] max-w-[90vw]">
        <div className="relative">
          <img
            src={`/api/game-assets/file/${node.path}`}
            alt={node.name}
            className={cn("max-h-[85vh] rounded-lg object-contain shadow-2xl", showInfo ? "max-w-[60vw]" : "max-w-[80vw]")}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfo(!showInfo);
            }}
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            title="File info"
          >
            <Info size="0.875rem" />
          </button>
        </div>

        {showInfo && info && (
          <div
            className="ml-4 w-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="mb-3 text-sm font-semibold text-[var(--foreground)]">File Info</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Name</span>
                <span className="text-right text-[var(--foreground)]">{info.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Size</span>
                <span className="text-[var(--foreground)]">{formatBytes(info.size)}</span>
              </div>
              {info.width != null && info.height != null && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Dimensions</span>
                  <span className="text-[var(--foreground)]">{info.width} × {info.height}</span>
                </div>
              )}
              {info.format && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Format</span>
                  <span className="uppercase text-[var(--foreground)]">{info.format}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Modified</span>
                <span className="text-[var(--foreground)]">{formatDate(info.modified)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">{node.name}</p>
    </div>
  );
}

// ════════════════════════════════════════════════
// Audio Player Modal
// ════════════════════════════════════════════════

const AUDIO_MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
};

function AudioPlayerModal({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const mime = AUDIO_MIME_MAP[ext] || "audio/mpeg";
  const [playError, setPlayError] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">{name}</h3>
        <audio
          controls
          className="w-full"
          autoPlay
          onError={() => setPlayError(true)}
        >
          <source src={`/api/game-assets/file/${path}`} type={mime} />
          Your browser does not support the audio element.
        </audio>
        {playError && (
          <p className="mt-2 text-xs text-[var(--destructive)]">
            Your browser can't play {ext} files. Use the download button below.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <a
            href={`/api/game-assets/file/${path}`}
            download={name}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Download
          </a>
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Image Info Popover
// ════════════════════════════════════════════════

function ImageInfoPopover({
  node,
  onClose,
}: {
  node: TreeNode;
  onClose: () => void;
}) {
  const { data: info } = useGameAssetFileInfo(node.path);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    requestAnimationFrame(() => document.addEventListener("mousedown", handle));
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-b-none max-sm:border-b-0 sm:right-4 sm:top-20 sm:w-64"
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--foreground)]">File Info</h4>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <X size="0.875rem" />
        </button>
      </div>
      {info ? (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Name</span>
            <span className="text-right text-[var(--foreground)]">{info.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Size</span>
            <span className="text-[var(--foreground)]">{formatBytes(info.size)}</span>
          </div>
          {info.width != null && info.height != null && (
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Dimensions</span>
              <span className="text-[var(--foreground)]">{info.width} × {info.height}</span>
            </div>
          )}
          {info.format && (
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Format</span>
              <span className="uppercase text-[var(--foreground)]">{info.format}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Modified</span>
            <span className="text-[var(--foreground)]">{formatDate(info.modified)}</span>
          </div>
        </div>
      ) : (
        <div className="text-sm text-[var(--muted-foreground)]">Loading...</div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
// File Editor Modal
// ════════════════════════════════════════════════

function FileEditorModal({
  node,
  onClose,
  initialMode = "edit",
}: {
  node: TreeNode;
  onClose: () => void;
  initialMode?: "edit" | "preview";
}) {
  const { data, isLoading } = useGameAssetFileContent(node.path);
  const saveFile = useSaveGameAssetFile();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">(initialMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (data) setContent(data.content);
  }, [data]);

  const lines = useMemo(() => content.split("\n").length, [content]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1).join("\n"),
    [lines],
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newValue = content.substring(0, start) + "  " + content.substring(end);
    setContent(newValue);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  }, [content]);

  const handleSave = useCallback(async () => {
    try {
      await saveFile.mutateAsync({ path: node.path, content });
      toast.success("File saved");
      onClose();
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [saveFile, node.path, content, onClose]);

  const isMd = node.ext === ".md";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)]/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText size="1rem" className="text-[var(--primary)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">{node.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {isMd && (
              <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                <button
                  onClick={() => setMode("preview")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "preview" ? "bg-[var(--accent)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Preview
                </button>
                <button
                  onClick={() => setMode("edit")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "edit" ? "bg-[var(--accent)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Edit
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="1rem" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
          ) : mode === "preview" && isMd ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="prose prose-sm max-w-none text-[var(--foreground)]">
                {renderMarkdownBlocks(content, applyInlineMarkdown, "editor-preview")}
              </div>
            </div>
          ) : (
            <div className="grid h-full grid-cols-[3rem_minmax(0,1fr)]">
              <pre
                ref={lineNumbersRef}
                className="h-full overflow-hidden border-r border-[var(--border)]/40 bg-[var(--accent)]/30 py-3 pr-2 text-right font-mono text-xs leading-relaxed text-[var(--muted-foreground)]"
              >
                {lineNumbers}
              </pre>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className="h-full w-full resize-none bg-[var(--card)] p-3 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)]/40 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveFile.isPending}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveFile.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Main View
// ════════════════════════════════════════════════

export function GameAssetsBrowserView() {
  const { data: tree, isLoading } = useGameAssetTree();
  const createFolder = useCreateGameAssetFolder();
  const deleteFolder = useDeleteGameAssetFolder();
  const renameAsset = useRenameGameAsset();
  const moveAsset = useMoveGameAsset();
  const copyAsset = useCopyGameAsset();
  const deleteAsset = useDeleteGameAsset();
  const openFolder = useOpenGameAssetsFolder();
  const rescan = useRescanGameAssets();
  const upload = useUploadGameAsset();

  const [selectedPath, setSelectedPath] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["", "music", "sfx", "ambient", "sprites", "backgrounds"]));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [previewImage, setPreviewImage] = useState<TreeNode | null>(null);
  const [previewAudio, setPreviewAudio] = useState<TreeNode | null>(null);
  const [editingFile, setEditingFile] = useState<{ node: TreeNode; mode: "edit" | "preview" } | null>(null);
  const [imageInfoNode, setImageInfoNode] = useState<TreeNode | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [listColumns, setListColumns] = useState({ size: true, modified: false });

  const [modal, setModal] = useState<
    | null
    | { type: "create-folder" }
    | { type: "rename"; node: TreeNode }
    | { type: "move"; node: TreeNode }
    | { type: "delete"; node: TreeNode }
    | { type: "new-text-file" }
    | { type: "new-markdown-file" }
  >(null);
  const [modalValue, setModalValue] = useState("");
  const [deleteRecursive, setDeleteRecursive] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const saveFile = useSaveGameAssetFile();

  const selectedNode = useMemo(() => {
    if (!tree) return null;
    if (selectedPath === "") return tree;
    function find(node: TreeNode): TreeNode | null {
      if (node.path === selectedPath) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = find(child);
          if (found) return found;
        }
      }
      return null;
    }
    return find(tree);
  }, [tree, selectedPath]);

  const currentChildren = useMemo(() => {
    if (!selectedNode?.children) return [];
    const children = selectedNode.children;
    if (!search) return children;
    const q = search.toLowerCase();
    return children.filter((c) => c.name.toLowerCase().includes(q));
  }, [selectedNode, search]);

  const breadcrumb = useMemo(() => {
    if (!selectedPath) return ["Game Assets"];
    return ["Game Assets", ...selectedPath.split("/")];
  }, [selectedPath]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const getUploadErrorMessage = useCallback((err: unknown, file: File, _category: string): string => {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("File too large")) return msg;
    if (msg.includes("Can't upload")) return `${msg} You can still create text files (.txt, .md, .json, etc.) here via the New menu.`;
    if (msg.includes("Invalid category")) return `Please navigate to a category folder (music, sfx, ambient, sprites, backgrounds) before uploading.`;
    if (msg.includes("Invalid upload")) return `Upload failed for ${file.name}. Please check the file and try again.`;
    return `Failed to upload ${file.name}: ${msg || "Unknown error"}`;
  }, []);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const parts = selectedPath.split("/").filter(Boolean);
      const category = parts[0] ?? "sfx";
      const subcategory = parts.slice(1).join("/");

      for (const file of files) {
        try {
          await upload.mutateAsync({ file, category, subcategory });
          toast.success(`Uploaded ${file.name}`);
        } catch (err) {
          toast.error(getUploadErrorMessage(err, file, category));
        }
      }
    },
    [selectedPath, upload, getUploadErrorMessage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleCopy = useCallback(
    async (node: TreeNode) => {
      const targetFolder = selectedPath;
      try {
        await copyAsset.mutateAsync({ path: node.path, targetFolder });
        toast.success("Copied");
      } catch (err) {
        toast.error(`Copy failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [copyAsset, selectedPath],
  );

  const handleDownload = useCallback((node: TreeNode) => {
    const a = document.createElement("a");
    a.href = `/api/game-assets/file/${node.path}`;
    a.download = node.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const getActionItems = useCallback(
    (node: TreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];

      if (node.type === "folder") {
        items.push(
          { label: "Create subfolder", onSelect: () => setModal({ type: "create-folder" }) },
          { label: "Open in system folder", onSelect: () => openFolder.mutate(node.path) },
        );
        if (node.path !== "" && (!node.children || node.children.length === 0)) {
          items.push({
            label: "Delete folder",
            onSelect: () => setModal({ type: "delete", node }),
            destructive: true,
          });
        }
      } else {
        if (isEditableText(node.ext)) {
          items.push({
            label: "Edit",
            icon: <Pencil size="0.875rem" />,
            onSelect: () => setEditingFile({ node, mode: node.ext === ".md" ? "preview" : "edit" }),
          });
        }
        if (isImage(node.ext)) {
          items.push({
            label: "Info",
            icon: <Info size="0.875rem" />,
            onSelect: () => setImageInfoNode(node),
          });
        }
        items.push(
          { label: "Download", onSelect: () => handleDownload(node) },
          { label: "Rename", onSelect: () => { setModal({ type: "rename", node }); setModalValue(node.name); } },
          { label: "Move", onSelect: () => setModal({ type: "move", node }) },
          { label: "Copy", onSelect: () => handleCopy(node) },
          { label: "Delete", onSelect: () => setModal({ type: "delete", node }), destructive: true },
        );
      }
      return items;
    },
    [openFolder, handleDownload, handleCopy],
  );

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [];
    return getActionItems(contextMenu.node);
  }, [contextMenu, getActionItems]);

  const handleModalConfirm = useCallback(async () => {
    if (!modal) return;
    try {
      if (modal.type === "create-folder") {
        const newPath = selectedPath ? `${selectedPath}/${modalValue}` : modalValue;
        await createFolder.mutateAsync(newPath);
        toast.success("Folder created");
      } else if (modal.type === "new-text-file" || modal.type === "new-markdown-file") {
        const ext = modal.type === "new-text-file" ? ".txt" : ".md";
        const filename = modalValue.endsWith(ext) ? modalValue : `${modalValue}${ext}`;
        const filePath = selectedPath ? `${selectedPath}/${filename}` : filename;
        await saveFile.mutateAsync({ path: filePath, content: "" });
        toast.success("File created");
        // Open editor for the new file
        const newNode: TreeNode = { name: filename, path: filePath, type: "file", ext };
        setEditingFile({ node: newNode, mode: ext === ".md" ? "preview" : "edit" });
      } else if (modal.type === "rename") {
        await renameAsset.mutateAsync({ path: modal.node.path, newName: modalValue });
        toast.success("Renamed");
      } else if (modal.type === "move") {
        await moveAsset.mutateAsync({ path: modal.node.path, targetFolder: modalValue });
        toast.success("Moved");
      } else if (modal.type === "delete") {
        if (modal.node.type === "folder") {
          await deleteFolder.mutateAsync({ path: modal.node.path, recursive: deleteRecursive });
          toast.success("Folder deleted");
        } else {
          await deleteAsset.mutateAsync(modal.node.path);
          toast.success("File deleted");
        }
      }
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
    setModal(null);
    setModalValue("");
    setDeleteRecursive(false);
  }, [modal, modalValue, selectedPath, deleteRecursive, createFolder, saveFile, renameAsset, moveAsset, deleteFolder, deleteAsset]);

  const moveTargetFolders = useMemo(() => {
    if (!tree) return [];
    const folders: { path: string; name: string }[] = [];
    function collect(node: TreeNode, prefix: string) {
      if (node.type === "folder") {
        folders.push({ path: node.path, name: prefix ? `${prefix} / ${node.name}` : node.name });
        if (node.children) {
          for (const child of node.children) {
            if (child.type === "folder") collect(child, prefix ? `${prefix} / ${node.name}` : node.name);
          }
        }
      }
    }
    if (tree.children) {
      for (const child of tree.children) {
        if (child.type === "folder") collect(child, "");
      }
    }
    return folders;
  }, [tree]);

  const updateDescription = useUpdateFolderDescription();
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState("");

  const handleSelectFile = useCallback((node: TreeNode) => {
    if (isImage(node.ext)) {
      setPreviewImage(node);
    } else if (isAudio(node.ext)) {
      setPreviewAudio(node);
    } else if (isEditableText(node.ext)) {
      setEditingFile({ node, mode: node.ext === ".md" ? "preview" : "edit" });
    }
  }, []);

  const currentDescription = selectedNode?.description ?? DEFAULT_DESCRIPTIONS[selectedPath] ?? "";

  const handleSaveDescription = useCallback(async () => {
    try {
      await updateDescription.mutateAsync({ path: selectedPath, description: descriptionValue });
      setEditingDescription(false);
      toast.success("Description saved");
    } catch (err) {
      toast.error(`Failed to save description: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [updateDescription, selectedPath, descriptionValue]);

  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      {/* Toolbar */}
      <Toolbar
        breadcrumb={breadcrumb}
        search={search}
        onSearch={setSearch}
        viewMode={viewMode}
        onViewMode={setViewMode}
        onUploadClick={() => uploadRef.current?.click()}
        onNewFolder={() => { setModal({ type: "create-folder" }); setModalValue(""); }}
        onNewTextFile={() => { setModal({ type: "new-text-file" }); setModalValue(""); }}
        onNewMarkdownFile={() => { setModal({ type: "new-markdown-file" }); setModalValue(""); }}
        onRescan={() => rescan.mutate()}
        onOpenFolder={() => openFolder.mutate(selectedPath || undefined)}
        onBreadcrumbClick={(path) => setSelectedPath(path)}
        listColumns={listColumns}
        onToggleColumn={(col) => setListColumns((prev) => ({ ...prev, [col]: !prev[col] }))}
      />

      {/* Folder Description */}
      {selectedNode?.type === "folder" && (
        <div className="flex min-h-[28px] items-center border-b border-[var(--border)]/40 bg-[var(--card)]/30 px-4 py-1">
          {editingDescription ? (
            <div className="flex w-full items-center gap-2">
              <input
                autoFocus
                type="text"
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveDescription();
                  if (e.key === "Escape") setEditingDescription(false);
                }}
                placeholder="What is this folder for?"
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50"
                maxLength={500}
              />
              <button
                onClick={handleSaveDescription}
                className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Save
              </button>
              <button
                onClick={() => setEditingDescription(false)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDescriptionValue(currentDescription);
                setEditingDescription(true);
              }}
              className="flex w-full items-center gap-1.5 text-left text-xs transition-colors"
            >
              <FileText size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
              <span className={currentDescription ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>
                {currentDescription || "Add description..."}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar tree */}
        <div className="w-56 overflow-y-auto border-r border-[var(--border)]/40 bg-[var(--card)]/30 p-2 max-md:hidden">
          {isLoading ? (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">Loading...</div>
          ) : tree ? (
            <FolderTree
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={toggleExpanded}
              onSelect={setSelectedPath}
            />
          ) : null}
        </div>

        {/* Main grid */}
        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden transition-colors",
            dragOver && "bg-[var(--primary)]/5",
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">Loading assets...</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <AssetGrid
                nodes={currentChildren}
                viewMode={viewMode}
                onContextMenu={handleContextMenu}
                onSelectFile={handleSelectFile}
                onNavigateFolder={setSelectedPath}
                onOpenActionMenu={(node, anchorEl) => {
                  const rect = anchorEl.getBoundingClientRect();
                  setActionMenu({ node, x: rect.right - 160, y: rect.bottom + 4 });
                }}
                listColumns={listColumns}
              />
            </div>
          )}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-2xl border-2 border-dashed border-[var(--primary)]/30 bg-[var(--primary)]/5 px-8 py-6 text-center">
                <Upload size="2rem" className="mx-auto mb-2 text-[var(--primary)]" />
                <p className="text-sm font-medium text-[var(--primary)]">Drop files to upload</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden upload input */}
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      {/* Context menu (desktop right-click) */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Action dropdown (3-dot menu) */}
      {actionMenu && (
        <ActionDropdown
          items={getActionItems(actionMenu.node)}
          x={actionMenu.x}
          y={actionMenu.y}
          onClose={() => setActionMenu(null)}
        />
      )}

      {/* Image preview */}
      {previewImage && (
        <ImagePreviewModal
          node={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}

      {/* Audio preview */}
      {previewAudio && (
        <AudioPlayerModal
          path={previewAudio.path}
          name={previewAudio.name}
          onClose={() => setPreviewAudio(null)}
        />
      )}

      {/* File editor */}
      {editingFile && (
        <FileEditorModal
          node={editingFile.node}
          initialMode={editingFile.mode}
          onClose={() => setEditingFile(null)}
        />
      )}

      {/* Image info popover */}
      {imageInfoNode && (
        <ImageInfoPopover
          node={imageInfoNode}
          onClose={() => setImageInfoNode(null)}
        />
      )}

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              {modal.type === "create-folder" && "Create Folder"}
              {modal.type === "new-text-file" && "New Text File"}
              {modal.type === "new-markdown-file" && "New Markdown File"}
              {modal.type === "rename" && "Rename"}
              {modal.type === "move" && "Move To Folder"}
              {modal.type === "delete" && `Delete ${modal.node.type === "folder" ? "Folder" : "File"}?`}
            </h3>

            {modal.type === "delete" ? (
              <div className="mb-4 text-sm text-[var(--muted-foreground)]">
                <p>
                  Are you sure you want to delete <strong className="text-[var(--foreground)]">{modal.node.name}</strong>?
                </p>
                {modal.node.type === "folder" && (
                  <div className="mt-2">
                    {(() => {
                      const itemCount = countItems(modal.node);
                      if (itemCount === 0) {
                        return <p>This folder is empty.</p>;
                      }
                      return (
                        <>
                          <p className="text-[var(--destructive)]">
                            This folder contains {itemCount} item{itemCount !== 1 ? "s" : ""}.
                          </p>
                          <label className="mt-2 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={deleteRecursive}
                              onChange={(e) => setDeleteRecursive(e.target.checked)}
                              className="rounded border-[var(--border)]"
                            />
                            <span className="text-xs">Delete everything inside</span>
                          </label>
                          {!deleteRecursive && (
                            <p className="mt-1 text-xs text-[var(--destructive)]">
                              You must check the box to delete a non-empty folder.
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : modal.type === "move" ? (
              <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
                {moveTargetFolders.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => setModalValue(f.path)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      modalValue === f.path ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <Folder size="0.875rem" />
                    {f.name || "Root"}
                  </button>
                ))}
              </div>
            ) : (
              <input
                autoFocus
                type="text"
                value={modalValue}
                onChange={(e) => setModalValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleModalConfirm()}
                placeholder={modal.type === "create-folder" ? "Folder name" : "New name"}
                className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 focus:ring-1 focus:ring-[var(--primary)]/20"
              />
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setModal(null); setModalValue(""); setDeleteRecursive(false); }}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Cancel
              </button>
              <button
                onClick={handleModalConfirm}
                disabled={modal.type === "delete" && modal.node.type === "folder" && countItems(modal.node) > 0 && !deleteRecursive}
                className={cn(
                  "rounded-lg px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90",
                  modal.type === "delete" ? "bg-[var(--destructive)] text-white" : "bg-[var(--primary)] text-white",
                  modal.type === "delete" && modal.node.type === "folder" && countItems(modal.node) > 0 && !deleteRecursive && "cursor-not-allowed opacity-50",
                )}
              >
                {modal.type === "delete" ? "Delete" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
