// ──────────────────────────────────────────────
// File Browser — Full-screen image preview with info panel
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { TreeNode } from "../../hooks/use-game-assets";
import { useGameAssetFileInfo } from "../../hooks/use-game-assets";
import { cn } from "../../lib/utils";
import { formatBytes, formatDate } from "../../lib/format";
import { encodeAssetPath } from "./encode-asset-path";

/**
 * Full-screen image preview overlay with optional metadata side panel.
 *
 * Press Escape or click the backdrop to close.
 * @param node - Image file node to preview
 * @param onClose - Callback when modal should close
 */
export function ImagePreviewModal({
  node,
  onClose,
}: {
  node: TreeNode;
  onClose: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const { data: info } = useGameAssetFileInfo(node.path);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${node.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative flex max-h-[90vh] max-w-[90vw]">
        <div className="relative">
          <img
            src={`/api/game-assets/file/${encodeAssetPath(node.path)}`}
            alt={node.name}
            className={cn(
              "max-h-[85vh] rounded-lg object-contain shadow-2xl",
              showInfo ? "max-w-[60vw]" : "max-w-[80vw]",
            )}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label={showInfo ? "Hide file info" : "Show file info"}
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
                  <span className="text-[var(--foreground)]">
                    {info.width} × {info.height}
                  </span>
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
