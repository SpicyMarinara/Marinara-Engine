// ──────────────────────────────────────────────
// Chat: Mari Capability Notice
// ──────────────────────────────────────────────
// One-time warning shown above the input bar in any chat where Professor
// Mari is a participant. Tells the user that her [update_character] /
// [update_persona] commands write straight to the library with no preview
// and no undo, so they should back up cards before asking her to edit
// existing ones. Dismissal persists in localStorage so the warning shows
// at most once across all of the user's Mari chats.
import { memo, useMemo, useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { PROFESSOR_MARI_ID } from "@marinara-engine/shared";
import { useChatStore } from "../../stores/chat.store";
import { useChat } from "../../hooks/use-chats";

const STORAGE_KEY = "mari-capability-notice-dismissed-v1";

function isMariParticipant(activeChat: unknown): boolean {
  const raw = (activeChat as { characterIds?: unknown } | null | undefined)?.characterIds;
  if (Array.isArray(raw)) return raw.includes(PROFESSOR_MARI_ID);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.includes(PROFESSOR_MARI_ID);
    } catch {
      return false;
    }
  }
  return false;
}

export const MariCapabilityNotice = memo(function MariCapabilityNotice() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: activeChat } = useChat(activeChatId);
  const isMariChat = useMemo(() => isMariParticipant(activeChat), [activeChat]);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Re-check storage when navigating into a Mari chat — covers other tabs
  // dismissing it while this one was open.
  useEffect(() => {
    if (!isMariChat) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setDismissed(true);
    } catch {
      /* private mode / disabled storage — fall back to in-memory state */
    }
  }, [isMariChat]);

  if (!isMariChat || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* non-fatal */
    }
  };

  return (
    <div
      role="note"
      className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--foreground)]"
    >
      <AlertTriangle size="0.875rem" className="mt-0.5 shrink-0 text-amber-500" />
      <p className="flex-1 leading-relaxed">
        Mari can edit your characters and personas directly when you ask her to update them. Character edits keep a
        recoverable version snapshot you can roll back to from the character's history.{" "}
        <strong className="font-semibold">Persona edits overwrite without a snapshot — back up the persona first</strong>{" "}
        if you want to keep the old version.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notice"
        className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      >
        <X size="0.75rem" />
      </button>
    </div>
  );
});
