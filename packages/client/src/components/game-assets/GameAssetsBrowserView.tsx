// ──────────────────────────────────────────────
// View: File Browser (full-page overlay)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useRef } from "react";
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
  Sparkles,
  MoreHorizontal,
  Download,
  Play,
  Pause,
} from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
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
  type TreeNode,
} from "../../hooks/use-game-assets";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  music: Music,
  sfx: Volume2,
  ambient: Wind,
  sprites: Sparkles,
  backgrounds: Image,
};

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  music: "Background music for game states: exploration, dialogue, combat, travel/rest",
  sfx: "Sound effects for UI, combat, and exploration events",
  ambient: "Environmental background audio: nature, urban, interior",
  sprites: "Character and object sprites for visual novel / game modes",
  backgrounds: "Scene backgrounds for roleplay and game modes",
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]);

function isImage(ext?: string) {
  return IMAGE_EXTS.has(ext ?? "");
}

function isAudio(ext?: string) {
  return AUDIO_EXTS.has(ext ?? "");
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
          <span className="truncate">{isRoot ? "File Browser" : node.name}</span>
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
// Toolbar
// ════════════════════════════════════════════════

function Toolbar({
  breadcrumb,
  search,
  onSearch,
  viewMode,
  onViewMode,
  onUploadClick,
  onCreateFolder,
  onRescan,
  onOpenFolder,
  onBreadcrumbClick,
}: {
  breadcrumb: string[];
  search: string;
  onSearch: (v: string) => void;
  viewMode: "grid" | "list";
  onViewMode: (v: "grid" | "list") => void;
  onUploadClick: () => void;
  onCreateFolder: () => void;
  onRescan: () => void;
  onOpenFolder: () => void;
  onBreadcrumbClick: (path: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]/40 bg-[var(--card)]/60 px-4 py-2 backdrop-blur-sm">
      {/* Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {breadcrumb.map((part, i) => {
          const isLast = i === breadcrumb.length - 1;
          const pathUpToHere = breadcrumb.slice(1, i + 1).filter(Boolean).join("/");
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size="0.75rem" className="text-[var(--muted-foreground)]" />}
              {isLast ? (
                <span className="truncate font-medium text-[var(--foreground)]">
                  {part || "File Browser"}
                </span>
              ) : (
                <button
                  onClick={() => onBreadcrumbClick(pathUpToHere)}
                  className="truncate text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  {part || "File Browser"}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size="0.875rem" className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search assets..."
          className="h-8 w-48 rounded-lg border border-[var(--border)] bg-[var(--background)] pl-7 pr-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 focus:ring-1 focus:ring-[var(--primary)]/20 max-sm:w-32"
        />
      </div>

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

      {/* Actions */}
      <button onClick={onUploadClick} className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
        <Upload size="0.875rem" />
        <span className="max-sm:hidden">Upload</span>
      </button>
      <button onClick={onCreateFolder} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]">
        <Plus size="0.875rem" />
        <span className="max-sm:hidden">Folder</span>
      </button>
      <button onClick={onRescan} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]" title="Rescan">
        <RefreshCw size="0.875rem" />
      </button>
      <button onClick={onOpenFolder} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]" title="Open in system folder">
        <ExternalLink size="0.875rem" />
      </button>
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
}: {
  nodes: TreeNode[];
  viewMode: "grid" | "list";
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onSelectFile: (node: TreeNode) => void;
  onNavigateFolder: (path: string) => void;
  onOpenActionMenu: (node: TreeNode, anchorEl: HTMLElement) => void;
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

            {node.type === "folder" ? (
              (() => {
                const CategoryIcon = CATEGORY_ICONS[node.name] || Folder;
                return <CategoryIcon size="2.5rem" className="text-[var(--primary)]" />;
              })()
            ) : isImage(node.ext) ? (
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)]">
                <img
                  src={`/api/game-assets/file/${node.path}`}
                  alt={node.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[var(--accent)]">
                <FileIcon ext={node.ext} className="h-8 w-8 text-[var(--primary)]" />
              </div>
            )}
            <span className="w-full truncate text-center text-xs text-[var(--foreground)]">{node.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
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
          className="group relative flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--accent)]"
        >
          {node.type === "folder" ? (
            <Folder size="1rem" className="shrink-0 text-[var(--primary)]" />
          ) : isImage(node.ext) ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--accent)]">
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
          <span className="flex-1 truncate text-sm text-[var(--foreground)]">{node.name}</span>
          {node.type === "file" && node.ext && (
            <span className="text-xs text-[var(--muted-foreground)] uppercase">{node.ext.replace(".", "")}</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenActionMenu(node, e.currentTarget);
            }}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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

function ImagePreviewModal({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-h-[85vh] max-w-[85vw]">
        <img
          src={`/api/game-assets/file/${path}`}
          alt={name}
          className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        <p className="mt-2 text-center text-sm text-white/80">{name}</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Audio Player Modal
// ════════════════════════════════════════════════

function AudioPlayerModal({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">{name}</h3>
        <audio controls className="w-full" autoPlay>
          <source src={`/api/game-assets/file/${path}`} />
          Your browser does not support the audio element.
        </audio>
        <div className="mt-4 flex justify-end">
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
  const [dragOver, setDragOver] = useState(false);

  const [modal, setModal] = useState<
    | null
    | { type: "create-folder" }
    | { type: "rename"; node: TreeNode }
    | { type: "move"; node: TreeNode }
    | { type: "delete"; node: TreeNode }
  >(null);
  const [modalValue, setModalValue] = useState("");
  const [deleteRecursive, setDeleteRecursive] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

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
    if (!selectedPath) return ["File Browser"];
    return ["File Browser", ...selectedPath.split("/")];
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

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const parts = selectedPath.split("/").filter(Boolean);
      const category = parts[0] ?? "sfx";
      const subcategory = parts.slice(1).join("/") || "custom";

      for (const file of files) {
        try {
          await upload.mutateAsync({ file, category, subcategory });
          toast.success(`Uploaded ${file.name}`);
        } catch (err) {
          toast.error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }
    },
    [selectedPath, upload],
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
  }, [modal, modalValue, selectedPath, deleteRecursive, createFolder, renameAsset, moveAsset, deleteFolder, deleteAsset]);

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
      {/* Header */}
      <div className="flex items-center border-b border-[var(--border)]/40 bg-[var(--card)]/60 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Folder size="1.125rem" className="text-[var(--primary)]" />
          <h2 className="text-sm font-semibold text-[var(--foreground)]">File Browser</h2>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        breadcrumb={breadcrumb}
        search={search}
        onSearch={setSearch}
        viewMode={viewMode}
        onViewMode={setViewMode}
        onUploadClick={() => uploadRef.current?.click()}
        onCreateFolder={() => { setModal({ type: "create-folder" }); setModalValue(""); }}
        onRescan={() => rescan.mutate()}
        onOpenFolder={() => openFolder.mutate(selectedPath || undefined)}
        onBreadcrumbClick={(path) => setSelectedPath(path)}
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
          path={previewImage.path}
          name={previewImage.name}
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

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              {modal.type === "create-folder" && "Create Folder"}
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
