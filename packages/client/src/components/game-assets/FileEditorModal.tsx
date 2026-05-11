// ──────────────────────────────────────────────
// File Browser — Text file editor modal
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import { useGameAssetFileContent, useSaveGameAssetFile } from "../../hooks/use-game-assets";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import { renderMarkdownBlocks, applyInlineMarkdown } from "../../lib/markdown";

const MAX_TEXT_LENGTH = 10_000_000; // ~10 MB char limit

/**
 * Props for the FileEditorModal component.
 */
export interface FileEditorModalProps {
  /** Text file node to edit */
  node: TreeNode;
  /** Callback when modal should close */
  onClose: () => void;
  /** Start in edit or preview mode (default: "edit") */
  initialMode?: "edit" | "preview";
}

/**
 * Modal text editor with line numbers, tab-to-spaces, and Markdown preview.
 *
 * Keyboard shortcuts:
 * - Ctrl/Cmd+S → save
 * - Escape → close (with dirty-check confirm)
 *
 * @param props - See {@link FileEditorModalProps}
 */
export function FileEditorModal({
  node,
  onClose,
  initialMode = "edit",
}: FileEditorModalProps) {
  const { data, isLoading } = useGameAssetFileContent(node.path);
  const saveFile = useSaveGameAssetFile();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">(initialMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const didInitRef = useRef(false);

  // Track dirty state against last loaded / saved content
  const originalContent = data?.content ?? "";
  const isDirty = content !== originalContent;

  useEffect(() => {
    if (data && !didInitRef.current) {
      setContent(data.content);
      didInitRef.current = true;
    }
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

  const handleSave = useCallback(async () => {
    try {
      await saveFile.mutateAsync({ path: node.path, content });
      toast.success("File saved");
      onClose();
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [saveFile, node.path, content, onClose]);

  const handleRequestClose = useCallback(() => {
    if (isDirty) {
      const discard = window.confirm("You have unsaved changes. Discard them?");
      if (!discard) return;
    }
    onClose();
  }, [isDirty, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newValue = content.substring(0, start) + "  " + content.substring(end);
        setContent(newValue);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
        return;
      }

      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isDirty) {
          handleSave();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        handleRequestClose();
        return;
      }
    },
    [content, isDirty, handleSave, handleRequestClose],
  );

  const isMd = node.ext === ".md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleRequestClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)]/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText size="1rem" className="text-[var(--primary)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {node.name}
              {isDirty && <span className="ml-1.5 text-[var(--muted-foreground)]">•</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isMd && (
              <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                <button
                  onClick={() => setMode("preview")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "preview"
                      ? "bg-[var(--accent)] text-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Preview
                </button>
                <button
                  onClick={() => setMode("edit")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === "edit"
                      ? "bg-[var(--accent)] text-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  Edit
                </button>
              </div>
            )}
            <button
              onClick={handleRequestClose}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="1rem" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
              Loading...
            </div>
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
                maxLength={MAX_TEXT_LENGTH}
                className="h-full w-full resize-none bg-[var(--card)] p-3 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)]/40 px-4 py-3">
          <span className="text-xs text-[var(--muted-foreground)]">
            {content.length.toLocaleString()} chars
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRequestClose}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saveFile.isPending || !isDirty}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveFile.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
