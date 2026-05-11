// ──────────────────────────────────────────────
// View: File Browser (full-page overlay)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Folder,
  Upload,
  Pencil,
  Info,
  FileText,
  Move,
  Copy,
  Trash2,
  X,
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
  useSaveGameAssetFile,
  useMoveGameAssetsBulk,
  useCopyGameAssetsBulk,
  useDeleteGameAssetsBulk,
  type TreeNode,
} from "../../hooks/use-game-assets";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

import { FolderTree } from "./FolderTree";
import { Toolbar } from "./Toolbar";
import { AssetGrid } from "./AssetGrid";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { AudioPlayerModal } from "./AudioPlayerModal";
import { ImageInfoPopover } from "./ImageInfoPopover";
import { FileEditorModal } from "./FileEditorModal";
import { ActionDropdown } from "./ActionDropdown";
import { DEFAULT_DESCRIPTIONS } from "./constants";
import { isImage, isAudio, isEditableText, countItems } from "./utils";
import { encodeAssetPath } from "./encode-asset-path";
import { useUIStore } from "../../stores/ui.store";

const PROTECTED_PATHS = new Set(["", "music", "sfx", "ambient", "sprites", "backgrounds"]);

/**
 * Full-screen overlay for browsing, previewing, and managing game assets.
 *
 * Features:
 * - Folder tree sidebar with expand/collapse
 * - Grid or list view with inline thumbnails
 * - Multi-select via always-visible checkboxes (files only)
 * - Bulk move/copy/delete via action bar
 * - Drag-and-drop upload
 * - Image/audio/text file previews
 * - Inline folder description editing
 * - Keyboard shortcuts: Ctrl+A (select all), Esc (clear selection)
 */
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
  const moveBulk = useMoveGameAssetsBulk();
  const copyBulk = useCopyGameAssetsBulk();
  const deleteBulk = useDeleteGameAssetsBulk();

  const [selectedPath, setSelectedPath] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(Object.keys(DEFAULT_DESCRIPTIONS)));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [actionMenu, setActionMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [previewImage, setPreviewImage] = useState<TreeNode | null>(null);
  const [previewAudio, setPreviewAudio] = useState<TreeNode | null>(null);
  const [editingFile, setEditingFile] = useState<{ node: TreeNode; mode: "edit" | "preview" } | null>(null);
  const [imageInfoNode, setImageInfoNode] = useState<TreeNode | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [listColumns, setListColumns] = useState({ size: true, modified: false });

  // Multi-select state (files only)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const [modal, setModal] = useState<
    | null
    | { type: "create-folder" }
    | { type: "rename"; node: TreeNode }
    | { type: "move"; node: TreeNode }
    | { type: "delete"; node: TreeNode }
    | { type: "new-text-file" }
    | { type: "new-markdown-file" }
    | { type: "bulk-move" }
    | { type: "bulk-copy" }
    | { type: "bulk-delete" }
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

  // Visible file nodes (for select-all)
  const visibleFileNodes = useMemo(
    () => currentChildren.filter((n) => n.type === "file"),
    [currentChildren],
  );

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

  // Selection handlers
  const handleToggleSelect = useCallback((node: TreeNode) => {
    if (node.type !== "file") return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const all = new Set(visibleFileNodes.map((n) => n.path));
    setSelectedPaths(all);
  }, [visibleFileNodes]);

  const handleClearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const isBrowserVisible = useUIStore((s) => s.gameAssetsBrowserOpen);

  // Modal Escape handler
  useEffect(() => {
    if (!modal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setModalValue("");
        setDeleteRecursive(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal]);

  // Keyboard shortcuts for selection (only when browser is visible, ignore inputs)
  useEffect(() => {
    if (!isBrowserVisible) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSelectAll();
      }
      if (e.key === "Escape" && selectedPaths.size > 0) {
        e.preventDefault();
        handleClearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isBrowserVisible, handleSelectAll, handleClearSelection, selectedPaths.size]);

  // Clear selection when changing folders
  useEffect(() => {
    handleClearSelection();
  }, [selectedPath, handleClearSelection]);

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
      if (selectedPath === "") {
        toast.error("Please navigate to a category folder before uploading.");
        return;
      }
      const parts = selectedPath.split("/").filter(Boolean);
      const category = parts[0] ?? "sfx";
      const subcategory = parts.slice(1).join("/");

      const fileArray = Array.from(files);
      const uploads = fileArray.map(async (file) => {
        try {
          await upload.mutateAsync({ file, category, subcategory });
          return { file, ok: true as const, err: null as unknown };
        } catch (err) {
          return { file, ok: false as const, err };
        }
      });

      const results = await Promise.all(uploads);
      for (const { file, ok, err } of results) {
        if (ok) {
          toast.success(`Uploaded ${file.name}`);
        } else {
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
    a.href = `/api/game-assets/file/${encodeAssetPath(node.path)}`;
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
        if (node.path !== "" && !PROTECTED_PATHS.has(node.path) && !node.native) {
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
      } else if (modal.type === "bulk-move") {
        const paths = Array.from(selectedPaths);
        const result = await moveBulk.mutateAsync({ paths, targetFolder: modalValue });
        const succeeded = result.succeeded.length;
        const failed = result.failed.length;
        if (succeeded > 0) {
          toast.success(`Moved ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
        }
        if (failed > 0) {
          toast.error(`${failed} file${failed !== 1 ? "s" : ""} failed to move`);
        }
        handleClearSelection();
      } else if (modal.type === "bulk-copy") {
        const paths = Array.from(selectedPaths);
        const result = await copyBulk.mutateAsync({ paths, targetFolder: modalValue });
        const succeeded = result.succeeded.length;
        const failed = result.failed.length;
        if (succeeded > 0) {
          toast.success(`Copied ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
        }
        if (failed > 0) {
          toast.error(`${failed} file${failed !== 1 ? "s" : ""} failed to copy`);
        }
        handleClearSelection();
      } else if (modal.type === "bulk-delete") {
        const paths = Array.from(selectedPaths);
        const result = await deleteBulk.mutateAsync(paths);
        const succeeded = result.succeeded.length;
        const failed = result.failed.length;
        if (succeeded > 0) {
          toast.success(`Deleted ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
        }
        if (failed > 0) {
          toast.error(`${failed} file${failed !== 1 ? "s" : ""} failed to delete`);
        }
        handleClearSelection();
      }
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
    setModal(null);
    setModalValue("");
    setDeleteRecursive(false);
  }, [modal, modalValue, selectedPath, deleteRecursive, selectedPaths, createFolder, saveFile, renameAsset, moveAsset, deleteFolder, deleteAsset, moveBulk, copyBulk, deleteBulk, handleClearSelection]);

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

      {/* Folder Description (hidden when selections exist) */}
      {selectedPaths.size === 0 && selectedNode?.type === "folder" && (
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
          ) : PROTECTED_PATHS.has(selectedPath) ? (
            <div className="flex w-full items-center gap-1.5 text-left text-xs">
              <FileText size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
              <span className="text-[var(--foreground)]">
                {currentDescription}
              </span>
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

      {/* Bulk action bar */}
      {selectedPaths.size > 0 && (
        <div className="flex min-h-[36px] items-center gap-3 border-b border-[var(--border)]/40 bg-[var(--primary)]/5 px-4 py-1.5">
          <span className="text-xs font-medium text-[var(--primary)]">
            {selectedPaths.size} file{selectedPaths.size !== 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={handleSelectAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              Select all
            </button>
            <div className="mx-1 h-3 w-px bg-[var(--border)]" />
            <button
              onClick={() => { setModal({ type: "bulk-move" }); setModalValue(""); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <Move size="0.75rem" />
              Move
            </button>
            <button
              onClick={() => { setModal({ type: "bulk-copy" }); setModalValue(""); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <Copy size="0.75rem" />
              Copy
            </button>
            <button
              onClick={() => setModal({ type: "bulk-delete" })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
            >
              <Trash2 size="0.75rem" />
              Delete
            </button>
            <div className="mx-1 h-3 w-px bg-[var(--border)]" />
            <button
              onClick={handleClearSelection}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Clear selection"
            >
              <X size="0.875rem" />
            </button>
          </div>
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
            "relative flex flex-1 flex-col overflow-hidden transition-colors",
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
                selectedPaths={selectedPaths}
                onToggleSelect={handleToggleSelect}
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
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
              {modal.type === "create-folder" && "Create Folder"}
              {modal.type === "new-text-file" && "New Text File"}
              {modal.type === "new-markdown-file" && "New Markdown File"}
              {modal.type === "rename" && "Rename"}
              {modal.type === "move" && "Move To Folder"}
              {modal.type === "delete" && `Delete ${modal.node.type === "folder" ? "Folder" : "File"}?`}
              {modal.type === "bulk-move" && `Move ${selectedPaths.size} file${selectedPaths.size !== 1 ? "s" : ""}`}
              {modal.type === "bulk-copy" && `Copy ${selectedPaths.size} file${selectedPaths.size !== 1 ? "s" : ""}`}
              {modal.type === "bulk-delete" && `Delete ${selectedPaths.size} file${selectedPaths.size !== 1 ? "s" : ""}?`}
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
            ) : modal.type === "move" || modal.type === "bulk-move" || modal.type === "bulk-copy" ? (
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
            ) : modal.type === "bulk-delete" ? (
              <div className="mb-4 text-sm text-[var(--muted-foreground)]">
                <p>
                  Are you sure you want to delete <strong className="text-[var(--foreground)]">{selectedPaths.size} file{selectedPaths.size !== 1 ? "s" : ""}</strong>?
                </p>
                <p className="mt-1 text-xs text-[var(--destructive)]">This action cannot be undone.</p>
              </div>
            ) : (
              <input
                autoFocus
                type="text"
                value={modalValue}
                onChange={(e) => setModalValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && modalValue.trim() && handleModalConfirm()}
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
                disabled={
                  (modal.type === "delete" && modal.node.type === "folder" && countItems(modal.node) > 0 && !deleteRecursive) ||
                  ((modal.type === "move" || modal.type === "bulk-move" || modal.type === "bulk-copy") && !modalValue)
                }
                className={cn(
                  "rounded-lg px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90",
                  modal.type === "delete" || modal.type === "bulk-delete" ? "bg-[var(--destructive)] text-white" : "bg-[var(--primary)] text-white",
                  (modal.type === "delete" && modal.node.type === "folder" && countItems(modal.node) > 0 && !deleteRecursive) && "cursor-not-allowed opacity-50",
                )}
              >
                {modal.type === "delete" || modal.type === "bulk-delete" ? "Delete" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
