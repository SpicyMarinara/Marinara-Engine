// ──────────────────────────────────────────────
// Pinned Image Overlay — Draggable/resizable floating images in the chat area
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import { Move, Download, X } from "lucide-react";
import { useGalleryStore } from "../../stores/gallery.store";
import type { ChatImage } from "../../hooks/use-gallery";

function PinnedImageViewer({ image, onClose }: { image: ChatImage; onClose: () => void }) {
  const [pos, setPos] = useState({ x: 80, y: 80 });
  const [size, setSize] = useState({ w: 400, h: 400 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Center on mount
  useEffect(() => {
    setPos({ x: Math.max(40, (window.innerWidth - 400) / 2), y: Math.max(40, (window.innerHeight - 400) / 2) });
  }, []);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [size],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;
    setSize({ w: Math.max(200, resizeRef.current.origW + dx), h: Math.max(200, resizeRef.current.origH + dy) });
  }, []);

  const onResizeEnd = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return (
    <div
      className="fixed z-[110] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex shrink-0 cursor-grab items-center gap-2 rounded-t-xl border-b border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 active:cursor-grabbing select-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <Move size={12} className="text-[var(--muted-foreground)]" />
        <span className="flex-1 truncate text-[11px] font-medium">{image.prompt || "Gallery Image"}</span>
        <a
          href={image.url}
          download
          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          onClick={(e) => e.stopPropagation()}
        >
          <Download size={12} />
        </a>
        <button
          onClick={onClose}
          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
        >
          <X size={12} />
        </button>
      </div>
      {/* Image content */}
      <div className="relative flex-1 overflow-hidden rounded-b-xl">
        <img
          src={image.url}
          alt={image.prompt || "Gallery image"}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-[var(--muted-foreground)]/40">
          <path d="M14 14L8 14L14 8Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

/** Renders all pinned gallery images as floating overlays. */
export function PinnedImageOverlay() {
  const pinnedImages = useGalleryStore((s) => s.pinnedImages);
  const unpinImage = useGalleryStore((s) => s.unpinImage);

  if (pinnedImages.length === 0) return null;

  return (
    <>
      {pinnedImages.map((img) => (
        <PinnedImageViewer key={img.id} image={img} onClose={() => unpinImage(img.id)} />
      ))}
    </>
  );
}
