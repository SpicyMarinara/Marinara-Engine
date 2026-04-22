import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { dismissActiveDialog, resolveActiveDialog } from "../../lib/app-dialogs";
import { useDialogStore } from "../../stores/dialog.store";

function getDialogTitle(kind: "alert" | "confirm" | "prompt", title?: string) {
  if (title) return title;
  if (kind === "alert") return "Notice";
  if (kind === "prompt") return "Input Required";
  return "Confirm Action";
}

export function AppDialogRenderer() {
  const dialog = useDialogStore((state) => state.dialog);
  const [promptValue, setPromptValue] = useState("");
  const promptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.kind !== "prompt") {
      setPromptValue("");
      return;
    }

    setPromptValue(dialog.defaultValue ?? "");
  }, [dialog]);

  useEffect(() => {
    if (dialog?.kind !== "prompt") return;

    const timer = window.setTimeout(() => {
      promptInputRef.current?.focus();
      promptInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [dialog]);

  if (!dialog) return null;

  const confirmToneClass =
    dialog.tone === "destructive"
      ? "bg-[var(--destructive)] text-white hover:bg-[var(--destructive)]/85"
      : "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/85";

  return (
    <Modal open onClose={dismissActiveDialog} title={getDialogTitle(dialog.kind, dialog.title)} width="max-w-sm">
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{dialog.message}</p>

        {dialog.kind === "prompt" && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              resolveActiveDialog(promptValue);
            }}
          >
            <input
              ref={promptInputRef}
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              placeholder={dialog.placeholder}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={dismissActiveDialog}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                {dialog.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="submit"
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${confirmToneClass}`}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </form>
        )}

        {dialog.kind === "confirm" && (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={dismissActiveDialog}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              {dialog.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => resolveActiveDialog(true)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${confirmToneClass}`}
            >
              {dialog.confirmLabel ?? "Confirm"}
            </button>
          </div>
        )}

        {dialog.kind === "alert" && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => resolveActiveDialog(undefined)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${confirmToneClass}`}
            >
              {dialog.confirmLabel ?? "OK"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
