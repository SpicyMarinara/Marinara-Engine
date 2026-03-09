// ──────────────────────────────────────────────
// Zustand Store: Pinned Gallery Images
// ──────────────────────────────────────────────
import { create } from "zustand";
import type { ChatImage } from "../hooks/use-gallery";

interface GalleryState {
  /** Images pinned to the chat area as floating overlays */
  pinnedImages: ChatImage[];
  pinImage: (image: ChatImage) => void;
  unpinImage: (imageId: string) => void;
  clearPinned: () => void;
}

export const useGalleryStore = create<GalleryState>((set) => ({
  pinnedImages: [],

  pinImage: (image) =>
    set((s) => (s.pinnedImages.some((p) => p.id === image.id) ? s : { pinnedImages: [...s.pinnedImages, image] })),

  unpinImage: (imageId) => set((s) => ({ pinnedImages: s.pinnedImages.filter((p) => p.id !== imageId) })),

  clearPinned: () => set({ pinnedImages: [] }),
}));
