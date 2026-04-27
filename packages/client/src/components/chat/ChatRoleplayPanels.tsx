import { useEffect, useRef, useState } from "react";
import { Globe, Loader2, PenLine, X } from "lucide-react";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useActiveLorebookEntries } from "../../hooks/use-lorebooks";

function WorldInfoEntryRow({
  entry,
}: {
  entry: { name: string; keys: string[]; content: string; constant: boolean; order: number };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="cursor-pointer rounded-lg bg-[var(--secondary)] p-2 text-xs transition-colors hover:bg-[var(--accent)]"
      onClick={() => setExpanded((prev) => !prev)}
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        <span className="truncate font-medium text-[var(--foreground)]/80">{entry.name}</span>
        {entry.constant && (
          <span className="shrink-0 rounded bg-amber-400/15 px-1 py-0.5 text-[0.5rem] font-medium text-amber-400">
            CONST
          </span>
        )}
        <span className="ml-auto shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">#{entry.order}</span>
      </div>
      {entry.keys.length > 0 && (
        <p className="mt-0.5 truncate text-[0.625rem] text-[var(--muted-foreground)]">
          Keys: {entry.keys.slice(0, 5).join(", ")}
          {entry.keys.length > 5 && ` +${entry.keys.length - 5}`}
        </p>
      )}
      {expanded && (
        <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-[var(--border)] pt-1.5 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
          {entry.content || "(empty)"}
        </p>
      )}
    </div>
  );
}

export function WorldInfoPanel({
  chatId,
  isMobile,
  onClose,
}: {
  chatId: string;
  isMobile: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useActiveLorebookEntries(chatId, true);
  const entries = data?.entries ?? [];

  return (
    <>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
        <Globe size="0.75rem" />
        Active World Info
        {isMobile && (
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.75rem" />
          </button>
        )}
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="0.75rem" className="animate-spin" />
          Scanning entries...
        </div>
      ) : entries.length === 0 ? (
        <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">No active entries for this chat</p>
      ) : (
        <>
          <p className="mb-2 text-[0.625rem] text-[var(--muted-foreground)]">
            {entries.length} active • ~{(data?.totalTokens ?? 0).toLocaleString()} tokens
          </p>
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <WorldInfoEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function AuthorNotesPanel({
  chatId,
  chatMeta,
  isMobile,
  onClose,
}: {
  chatId: string;
  chatMeta: Record<string, any>;
  isMobile: boolean;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState((chatMeta.authorNotes as string) ?? "");
  const [depthStr, setDepthStr] = useState(String((chatMeta.authorNotesDepth as number) ?? 4));
  const updateMeta = useUpdateChatMetadata();

  const latestRef = useRef({ notes, depthStr });
  latestRef.current = { notes, depthStr };
  const baselineRef = useRef({
    notes: (chatMeta.authorNotes as string) ?? "",
    depth: (chatMeta.authorNotesDepth as number) ?? 4,
  });
  const mutateRef = useRef(updateMeta.mutate);
  mutateRef.current = updateMeta.mutate;

  useEffect(() => {
    setNotes((chatMeta.authorNotes as string) ?? "");
    setDepthStr(String((chatMeta.authorNotesDepth as number) ?? 4));
    baselineRef.current = {
      notes: (chatMeta.authorNotes as string) ?? "",
      depth: (chatMeta.authorNotesDepth as number) ?? 4,
    };
  }, [chatMeta.authorNotes, chatMeta.authorNotesDepth]);

  // Outside-click closes the popover via mousedown, which unmounts the
  // textarea before its onBlur (the only save trigger) can fire. Flush
  // the pending edit from the unmount cleanup so typed content survives.
  useEffect(() => {
    const capturedChatId = chatId;
    return () => {
      const { notes: n, depthStr: d } = latestRef.current;
      const nextDepth = Math.max(0, parseInt(d, 10) || 0);
      const base = baselineRef.current;
      if (n !== base.notes || nextDepth !== base.depth) {
        mutateRef.current({ id: capturedChatId, authorNotes: n, authorNotesDepth: nextDepth });
      }
    };
  }, [chatId]);

  const depth = parseInt(depthStr, 10) || 0;
  const handleSave = () => {
    updateMeta.mutate({ id: chatId, authorNotes: notes, authorNotesDepth: depth });
  };

  return (
    <>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
        <PenLine size="0.75rem" />
        Author's Notes
        {isMobile && (
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.75rem" />
          </button>
        )}
      </h3>
      <p className="mb-2 text-[0.625rem] text-[var(--muted-foreground)]">
        Text here is injected into the prompt at the chosen depth every generation.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleSave}
        placeholder="e.g. Keep the tone dark and suspenseful. The villain is secretly an ally."
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-2 text-xs text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-[var(--ring)]"
        rows={4}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">Injection Depth</span>
        <input
          type="text"
          inputMode="numeric"
          value={depthStr}
          onChange={(e) => setDepthStr(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => {
            const nextDepth = Math.max(0, parseInt(depthStr, 10) || 0);
            setDepthStr(String(nextDepth));
            updateMeta.mutate({ id: chatId, authorNotes: notes, authorNotesDepth: nextDepth });
          }}
          className="w-14 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-center text-[0.625rem] text-[var(--foreground)] outline-none transition-colors [appearance:textfield] focus:ring-2 focus:ring-[var(--ring)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>
      <p className="mt-1 text-[0.5625rem] text-[var(--muted-foreground)]/60">
        Depth 0 = end of conversation, 4 = four messages from the end.
      </p>
    </>
  );
}
