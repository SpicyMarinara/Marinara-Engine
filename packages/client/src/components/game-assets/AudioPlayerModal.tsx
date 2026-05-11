// ──────────────────────────────────────────────
// File Browser — Audio player with format fallback
// ──────────────────────────────────────────────
import { useState } from "react";
import { AUDIO_MIME_MAP } from "@marinara-engine/shared";

export function AudioPlayerModal({
  path,
  name,
  onClose,
}: {
  path: string;
  name: string;
  onClose: () => void;
}) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const mime = AUDIO_MIME_MAP[ext] || "audio/mpeg";
  const [playError, setPlayError] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
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
