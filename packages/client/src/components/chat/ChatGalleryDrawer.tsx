// ──────────────────────────────────────────────
// Chat: Gallery Drawer — per-chat image gallery
// ──────────────────────────────────────────────
import { X } from "lucide-react";
import { ChatGallery } from "./ChatGallery";
import type { Chat } from "@marinara-engine/shared";

interface ChatGalleryDrawerProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  /** Manually trigger the Illustrator agent */
  onIllustrate?: () => void;
}

export function ChatGalleryDrawer({ chat, open, onClose, onIllustrate }: ChatGalleryDrawerProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute right-0 top-0 z-50 flex h-full w-80 max-md:w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up max-md:pt-[env(safe-area-inset-top)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">Gallery</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery drawer"
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ChatGallery chatId={chat.id} onIllustrate={onIllustrate} />
        </div>
      </div>
    </>
  );
}
