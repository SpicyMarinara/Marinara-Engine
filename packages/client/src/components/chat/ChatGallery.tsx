// ──────────────────────────────────────────────
// Chat Gallery — Image grid for per-chat generated images
// ──────────────────────────────────────────────
import { useState, useRef } from "react";
import { ImagePlus, Trash2, X, ZoomIn, Download, Sparkles, Pin, Minimize2 } from "lucide-react";
import {
  useGalleryImages,
  useUploadGalleryImage,
  useDeleteGalleryImage,
  type ChatImage,
} from "../../hooks/use-gallery";
import { useGalleryStore } from "../../stores/gallery.store";

interface ChatGalleryProps {
  chatId: string;
}

export function ChatGallery({ chatId }: ChatGalleryProps) {
  const { data: images, isLoading } = useGalleryImages(chatId);
  const upload = useUploadGalleryImage(chatId);
  const remove = useDeleteGalleryImage(chatId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<ChatImage | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pinImage = useGalleryStore((s) => s.pinImage);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    upload.mutate(formData);
    e.target.value = "";
  };

  const handleDelete = (id: string) => {
    remove.mutate(id);
    setConfirmDeleteId(null);
    if (lightbox?.id === id) setLightbox(null);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <ImagePlus size={16} />
        {upload.isPending ? "Uploading…" : "Upload Image"}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />

      {/* Loading state */}
      {isLoading && <p className="text-center text-xs text-[var(--muted-foreground)]">Loading gallery…</p>}

      {/* Empty state */}
      {!isLoading && (!images || images.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--muted-foreground)]">
          <Sparkles size={24} className="opacity-40" />
          <p className="text-xs">No images yet</p>
          <p className="text-[10px] opacity-60">Upload images or generate them to build your gallery</p>
        </div>
      )}

      {/* Image grid */}
      {images && images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-lg bg-[var(--secondary)] ring-1 ring-transparent transition-all hover:ring-[var(--primary)]/40 hover:shadow-lg"
            >
              <img
                src={img.url}
                alt={img.prompt || "Gallery image"}
                loading="lazy"
                className="aspect-square w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
                onClick={() => setLightbox(img)}
              />
              {/* Overlay */}
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex w-full items-center justify-between p-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setLightbox(img)}
                      className="rounded-md bg-white/20 p-1.5 text-white transition-colors hover:bg-white/30"
                      title="View fullscreen"
                    >
                      <ZoomIn size={12} />
                    </button>
                    <button
                      onClick={() => pinImage(img)}
                      className="rounded-md bg-white/20 p-1.5 text-white transition-colors hover:bg-white/30"
                      title="Pin to chat"
                    >
                      <Pin size={12} />
                    </button>
                  </div>
                  <button
                    onClick={() => setConfirmDeleteId(img.id)}
                    className="rounded-md bg-red-500/40 p-1.5 text-white transition-colors hover:bg-red-500/60"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {/* Prompt label */}
              {img.prompt && (
                <div className="absolute left-0 top-0 max-w-full truncate bg-black/50 px-2 py-0.5 text-[9px] text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  {img.prompt}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 rounded-xl bg-[var(--background)] p-5 shadow-2xl ring-1 ring-[var(--border)]">
            <p className="mb-4 text-sm font-medium">Delete this image?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 rounded-lg bg-[var(--secondary)] px-4 py-2 text-xs transition-colors hover:bg-[var(--accent)]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.url}
              alt={lightbox.prompt || "Gallery image"}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            />
            {/* Controls */}
            <div className="absolute right-2 top-2 flex gap-2">
              <button
                onClick={() => {
                  pinImage(lightbox);
                  setLightbox(null);
                }}
                className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                title="Pin to chat"
              >
                <Minimize2 size={14} />
              </button>
              <a
                href={lightbox.url}
                download
                className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              >
                <Download size={14} />
              </a>
              <button
                onClick={() => setLightbox(null)}
                className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
              >
                <X size={14} />
              </button>
            </div>
            {/* Info bar */}
            {(lightbox.prompt || lightbox.provider) && (
              <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/60 p-3 text-white backdrop-blur-sm">
                {lightbox.prompt && <p className="text-xs">{lightbox.prompt}</p>}
                {lightbox.provider && (
                  <p className="mt-1 text-[10px] text-white/60">
                    {lightbox.provider}
                    {lightbox.model ? ` · ${lightbox.model}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
