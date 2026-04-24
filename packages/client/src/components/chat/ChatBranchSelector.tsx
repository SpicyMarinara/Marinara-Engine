import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, Loader2, MessageSquare } from "lucide-react";
import { useChatGroup } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { cn } from "../../lib/utils";

interface ChatBranchSelectorProps {
  activeChatId: string | null;
  activeChatName?: string | null;
  groupId?: string | null;
  variant?: "conversation" | "roleplay";
}

export function ChatBranchSelector({
  activeChatId,
  activeChatName,
  groupId,
  variant = "conversation",
}: ChatBranchSelectorProps) {
  const { data: groupChats, isLoading } = useChatGroup(groupId ?? null);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 280,
  });

  const branches = useMemo(() => {
    const rows = [...(groupChats ?? [])];
    rows.sort((left, right) => {
      if (left.id === activeChatId) return -1;
      if (right.id === activeChatId) return 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
    return rows;
  }, [activeChatId, groupChats]);

  const currentBranch = branches.find((chat) => chat.id === activeChatId);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 280) - 12)),
      width: Math.max(rect.width, 280),
    });
  }, [branches.length, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const handleResize = () => setOpen(false);

    const handleScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  if (!groupId) return null;
  if (!isLoading && branches.length <= 1) return null;

  const branchLabel = currentBranch?.name ?? activeChatName ?? "Current branch";
  const buttonClassName =
    variant === "roleplay"
      ? "border border-foreground/10 bg-foreground/5 text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
      : "bg-black/30 text-foreground/90 hover:bg-black/50";
  const badgeClassName =
    variant === "roleplay" ? "bg-foreground/10 text-foreground/60" : "bg-black/30 text-foreground/60";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex max-w-[min(15rem,calc(100vw-9rem))] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left backdrop-blur-sm transition-colors",
          buttonClassName,
        )}
        title="Switch branch"
      >
        <GitBranch size="0.8125rem" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium">{branchLabel}</span>
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium", badgeClassName)}>
          {isLoading ? <Loader2 size="0.6875rem" className="animate-spin" /> : branches.length}
        </span>
        <ChevronDown size="0.75rem" className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/40"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            <div className="border-b border-[var(--border)] px-3 py-2">
              <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Chat Branches
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                Switch branches without opening Manage Chat Files.
              </div>
            </div>

            <div className="max-h-[min(22rem,calc(100vh-8rem))] overflow-y-auto p-2">
              {branches.map((branch) => {
                const isActive = branch.id === activeChatId;
                const updatedAt = new Date(branch.updatedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => {
                      setActiveChatId(branch.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                      isActive ? "bg-sky-500/10 text-[var(--foreground)]" : "hover:bg-[var(--accent)]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                        isActive
                          ? "bg-gradient-to-br from-sky-400 to-blue-500 text-white"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                      )}
                    >
                      {isActive ? <Check size="0.875rem" /> : <MessageSquare size="0.875rem" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{branch.name}</div>
                      <div className="text-[0.6875rem] text-[var(--muted-foreground)]">Updated {updatedAt}</div>
                    </div>

                    {isActive && (
                      <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-sky-400">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}