// ──────────────────────────────────────────────
// File Browser — Toolbar (breadcrumb, actions, dropdowns)
// ──────────────────────────────────────────────
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ExternalLink,
  FilePlus,
  FileText,
  Folder,
  Grid3X3,
  List,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { SearchInput } from "./SearchInput";

/**
 * Props for the Toolbar component.
 */
export interface ToolbarProps {
  /** Breadcrumb segments starting with "Game Assets" */
  breadcrumb: string[];
  /** Current search query */
  search: string;
  /** Callback when search changes */
  onSearch: (v: string) => void;
  /** Current view mode */
  viewMode: "grid" | "list";
  /** Switch view mode */
  onViewMode: (v: "grid" | "list") => void;
  /** Trigger hidden file input click */
  onUploadClick: () => void;
  /** Open "new folder" modal */
  onNewFolder: () => void;
  /** Open "new text file" modal */
  onNewTextFile: () => void;
  /** Open "new markdown file" modal */
  onNewMarkdownFile: () => void;
  /** Rescan assets and rebuild manifest */
  onRescan: () => void;
  /** Open current folder in OS file manager */
  onOpenFolder: () => void;
  /** Navigate to a breadcrumb path */
  onBreadcrumbClick: (path: string) => void;
  /** Which list columns are visible */
  listColumns: { size: boolean; modified: boolean };
  /** Toggle a list column */
  onToggleColumn: (col: "size" | "modified") => void;
}

/**
 * File browser toolbar: breadcrumb, search, view toggle, action buttons, dropdowns.
 *
 * @param props - See {@link ToolbarProps}
 */
export function Toolbar({
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
}: ToolbarProps) {
  const [newOpen, setNewOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const colsBtnRef = useRef<HTMLButtonElement>(null);
  const newDropdownRef = useRef<HTMLDivElement>(null);
  const colsDropdownRef = useRef<HTMLDivElement>(null);
  const [newPos, setNewPos] = useState({ x: 0, y: 0 });
  const [colsPos, setColsPos] = useState({ x: 0, y: 0 });

  // Close dropdowns when clicking outside (proper target check, no stopPropagation hack)
  useEffect(() => {
    if (!newOpen && !colsOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        newOpen &&
        !newBtnRef.current?.contains(t) &&
        !newDropdownRef.current?.contains(t)
      ) {
        setNewOpen(false);
      }
      if (
        colsOpen &&
        !colsBtnRef.current?.contains(t) &&
        !colsDropdownRef.current?.contains(t)
      ) {
        setColsOpen(false);
      }
    };
    const onScroll = () => {
      setNewOpen(false);
      setColsOpen(false);
    };
    // Defer registration to avoid the same click that opened the dropdown closing it.
    const raf = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handle);
      window.addEventListener("scroll", onScroll, true);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handle);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [newOpen, colsOpen]);

  const openNew = () => {
    const rect = newBtnRef.current?.getBoundingClientRect();
    if (rect) setNewPos({ x: rect.left, y: rect.bottom + 4 });
    setNewOpen((prev) => !prev);
  };

  const openCols = () => {
    const rect = colsBtnRef.current?.getBoundingClientRect();
    if (rect) setColsPos({ x: rect.left, y: rect.bottom + 4 });
    setColsOpen((prev) => !prev);
  };

  const dropdown = (
    open: boolean,
    pos: { x: number; y: number },
    children: ReactNode,
    ref: React.RefObject<HTMLDivElement | null>,
  ) =>
    open
      ? createPortal(
          <div
            ref={ref}
            className="fixed z-[60] min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
            style={{ left: pos.x, top: pos.y }}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--border)]/40 bg-[var(--card)]/60 px-4 py-2 backdrop-blur-sm">
      {/* Breadcrumb — full width, horizontal scroll on mobile */}
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
              viewMode === "grid"
                ? "bg-[var(--accent)] text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            title="Grid view"
          >
            <Grid3X3 size="0.875rem" />
          </button>
          <button
            onClick={() => onViewMode("list")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              viewMode === "list"
                ? "bg-[var(--accent)] text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
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
              colsDropdownRef,
            )}
          </>
        )}

        <button
          onClick={onUploadClick}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
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
              onClick={() => {
                onNewFolder();
                setNewOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <Folder size="0.875rem" />
              New folder
            </button>
            <button
              onClick={() => {
                onNewTextFile();
                setNewOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <FileText size="0.875rem" />
              New text file
            </button>
            <button
              onClick={() => {
                onNewMarkdownFile();
                setNewOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              <FilePlus size="0.875rem" />
              New markdown file
            </button>
          </>,
          newDropdownRef,
        )}

        <button
          onClick={onRescan}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          title="Rescan"
        >
          <RefreshCw size="0.875rem" />
        </button>
        <button
          onClick={onOpenFolder}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          title="Open in system folder"
        >
          <ExternalLink size="0.875rem" />
        </button>

        {/* Search (right-aligned via ml-auto) */}
        <SearchInput search={search} onSearch={onSearch} />
      </div>
    </div>
  );
}
