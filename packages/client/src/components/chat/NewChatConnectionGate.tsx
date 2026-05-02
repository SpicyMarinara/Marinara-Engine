import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, Plug, X, BookOpen } from "lucide-react";
import { useConnections } from "../../hooks/use-connections";
import { useCreateChat } from "../../hooks/use-chats";
import { useChatPresets, useApplyChatPreset } from "../../hooks/use-chat-presets";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { cn } from "../../lib/utils";

type Mode = "conversation" | "roleplay" | "game";

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode }> = {
  conversation: { label: "Conversation", icon: <MessageCircle size="0.875rem" /> },
  roleplay: { label: "Roleplay", icon: <BookOpen size="0.875rem" /> },
  game: { label: "Game", icon: <BookOpen size="0.875rem" /> },
};

interface NewChatConnectionGateProps {
  mode: Mode;
  onClose: () => void;
}

export function NewChatConnectionGate({ mode, onClose }: NewChatConnectionGateProps) {
  const { data: connections, isLoading } = useConnections();
  const createChat = useCreateChat();
  const { data: chatPresetsData } = useChatPresets();
  const applyChatPreset = useApplyChatPreset();
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const [connectionId, setConnectionId] = useState<string>("");

  const connectionRows = useMemo(() => (connections ?? []) as Array<{ id: string; name: string }>, [connections]);

  useEffect(() => {
    if (connectionRows.length === 0) {
      setConnectionId("");
      return;
    }
    setConnectionId((current) => current || connectionRows[0]!.id);
  }, [connectionRows]);

  const handleCreate = () => {
    if (!connectionId) return;
    const label = MODE_META[mode].label;
    const presets = chatPresetsData ?? [];
    const presetMode = mode === "conversation" || mode === "roleplay" ? mode : null;
    const starred = presetMode
      ? (presets.find((p) => p.mode === presetMode && p.isActive && !p.isDefault) ?? null)
      : null;
    createChat.mutate(
      {
        name: `New ${label}`,
        mode,
        characterIds: [],
        connectionId,
      },
      {
        onSuccess: async (chat) => {
          const store = useChatStore.getState();
          store.setPendingNewChatMode(null);
          store.setActiveChatId(chat.id);
          if (starred) {
            try {
              await applyChatPreset.mutateAsync({ presetId: starred.id, chatId: chat.id });
            } catch {
              /* non-fatal — chat still opens with system defaults */
            }
          }
          store.setShouldOpenSettings(true);
          store.setShouldOpenWizard(true);
        },
      },
    );
  };

  const showEmptyState = !isLoading && connectionRows.length === 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[var(--primary)]">{MODE_META[mode].icon}</span>
              <div>
                <h3 className="text-sm font-semibold">Set Up {MODE_META[mode].label}</h3>
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                  Choose a connection before we create the chat.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <X size="0.875rem" />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            {showEmptyState ? (
              <div className="rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/8 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <Plug size="0.875rem" className="text-[var(--primary)]" />
                  No connections found
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Create a connection first, then come back here and we&apos;ll continue without creating a ghost chat.
                </p>
                <button
                  onClick={() => openRightPanel("connections")}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/20"
                >
                  <Plug size="0.75rem" />
                  Open Connections
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Connection
                </label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  disabled={createChat.isPending}
                  className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-xs outline-none ring-1 ring-[var(--border)] transition-shadow focus:ring-[var(--primary)]/40"
                >
                  <option value="">Select a connection…</option>
                  {connectionRows.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={showEmptyState || !connectionId || createChat.isPending}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium shadow-sm transition-all active:scale-95",
                showEmptyState || !connectionId || createChat.isPending
                  ? "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)] opacity-60"
                  : "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90",
              )}
            >
              {createChat.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : MODE_META[mode].icon}
              Create Chat
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
