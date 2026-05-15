// ──────────────────────────────────────────────
// Quick Switcher Mobile — single chevron opens
// a tabbed menu with Connections + Personas
// (with persona group support)
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronRight, Link, CircleUser, FolderOpen, Folder, Check } from "lucide-react";
import { useConnections, useUpdateConnection } from "../../hooks/use-connections";
import { usePersonas, usePersonaGroups } from "../../hooks/use-characters";
import { useUpdateChat, useChat } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { filterLanguageGenerationConnections } from "../../lib/connection-filters";
import { cn, getAvatarCropStyle, parseAvatarCropJson } from "../../lib/utils";

interface Persona {
  id: string;
  name: string;
  avatarPath?: string | null;
  /** JSON-encoded AvatarCrop from the persona row. */
  avatarCrop?: string;
  comment?: string | null;
}

interface PersonaGroupRow {
  id: string;
  name: string;
  description: string;
  personaIds: string;
}

interface ParsedGroup {
  id: string;
  name: string;
  memberIds: string[];
  members: Persona[];
}

export function QuickSwitcherMobile() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"connections" | "personas">("connections");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: connections } = useConnections();
  const { data: rawPersonas } = usePersonas();
  const { data: rawPersonaGroups } = usePersonaGroups();
  const { data: chat } = useChat(activeChatId);
  const updateChat = useUpdateChat();
  const updateConnection = useUpdateConnection();

  const activeConnectionId = (chat as unknown as Record<string, unknown>)?.connectionId as string | null;
  const activePersonaId = (chat as unknown as Record<string, unknown>)?.personaId as string | null;
  const isRandom = activeConnectionId === "random";

  const sortedConnections = filterLanguageGenerationConnections(
    (connections ?? []) as Array<{ id: string; name: string; provider?: string; useForRandom?: string }>,
  ).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const sortedPersonas = ((rawPersonas ?? []) as Persona[])
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const personaMap = useMemo(() => {
    const map = new Map<string, Persona>();
    for (const p of sortedPersonas) map.set(p.id, p);
    return map;
  }, [sortedPersonas]);

  const { groups, ungrouped } = useMemo(() => {
    const groupRows = (rawPersonaGroups ?? []) as PersonaGroupRow[];
    const allGroupedIds = new Set<string>();
    const parsedGroups: ParsedGroup[] = [];

    for (const g of groupRows) {
      let memberIds: string[] = [];
      try {
        memberIds = JSON.parse(g.personaIds);
      } catch {
        memberIds = [];
      }
      const members: Persona[] = [];
      for (const pid of memberIds) {
        const p = personaMap.get(pid);
        if (p) {
          members.push(p);
          allGroupedIds.add(pid);
        }
      }
      if (members.length > 0) {
        parsedGroups.push({ id: g.id, name: g.name, memberIds, members });
      }
    }

    parsedGroups.sort((a, b) => a.name.localeCompare(b.name));
    const ungroupedList = sortedPersonas.filter((p) => !allGroupedIds.has(p.id));
    return { groups: parsedGroups, ungrouped: ungroupedList };
  }, [rawPersonaGroups, personaMap, sortedPersonas]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleSwitchConnection = useCallback(
    (connId: string | null) => {
      if (!activeChatId) return;
      updateChat.mutate({ id: activeChatId, connectionId: connId });
      setOpen(false);
    },
    [activeChatId, updateChat],
  );

  const handleToggleRandom = useCallback(() => {
    if (!activeChatId) return;
    updateChat.mutate({ id: activeChatId, connectionId: isRandom ? null : "random" });
  }, [activeChatId, isRandom, updateChat]);

  const handleTogglePool = useCallback(
    (connId: string, inPool: boolean) => {
      updateConnection.mutate({ id: connId, useForRandom: !inPool });
    },
    [updateConnection],
  );

  const handleSwitchPersona = useCallback(
    (personaId: string | null) => {
      if (!activeChatId) return;
      updateChat.mutate({ id: activeChatId, personaId });
      setOpen(false);
    },
    [activeChatId, updateChat],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const inputBox = btnRef.current!.closest(".rounded-2xl") as HTMLElement | null;
      const menuEl = menuRef.current;
      const menuHeight = menuEl?.offsetHeight || 400;
      if (inputBox) {
        const boxRect = inputBox.getBoundingClientRect();
        setPos({
          left: boxRect.left,
          top: Math.max(8, boxRect.top - menuHeight - 4),
          width: boxRect.width,
        });
      } else {
        const rect = btnRef.current!.getBoundingClientRect();
        setPos({
          left: 8,
          top: Math.max(8, rect.top - menuHeight - 8),
          width: 300,
        });
      }
    };
    requestAnimationFrame(update);
    const timer = setTimeout(update, 50);
    return () => clearTimeout(timer);
  }, [open, tab, expandedGroups]);

  if (!activeChatId) return null;

  const renderPersonaRow = (persona: Persona, indented: boolean = false) => {
    const isActive = persona.id === activePersonaId;
    return (
      <button
        key={persona.id}
        onClick={() => handleSwitchPersona(persona.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
          isActive && "text-foreground",
          indented && "pl-6",
        )}
      >
        {persona.avatarPath ? (
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-[var(--border)]">
            <img
              src={persona.avatarPath}
              alt={persona.name}
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(parseAvatarCropJson(persona.avatarCrop))}
            />
          </div>
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
            {(persona.name || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn("text-xs font-semibold", isActive && "text-foreground")}>
            {persona.name || persona.id}
          </span>
          {persona.comment && (
            <span className="truncate text-[0.625rem] leading-tight text-[var(--muted-foreground)]">
              {persona.comment.length > 60 ? persona.comment.substring(0, 60) + "…" : persona.comment}
            </span>
          )}
        </div>
        {isActive && <span className="ml-auto shrink-0 text-[0.6875rem]">✓</span>}
      </button>
    );
  };
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Quick Switcher"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
          open ? "text-foreground bg-foreground/10" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <ChevronUp size="1rem" className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="fixed z-[9999] flex max-h-[400px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: "hidden" as const }}
        >
          <div className="flex border-b border-[var(--border)]">
            <button
              onClick={() => setTab("connections")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-[0.6875rem] font-semibold transition-colors",
                tab === "connections"
                  ? "text-[var(--foreground)] border-b-2 border-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Link size="0.75rem" />
              Connections
            </button>
            <button
              onClick={() => setTab("personas")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-[0.6875rem] font-semibold transition-colors",
                tab === "personas"
                  ? "text-[var(--foreground)] border-b-2 border-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <CircleUser size="0.75rem" />
              Personas
            </button>
          </div>

          <div className="overflow-y-auto p-1">
            {tab === "connections" && (
              <>
                <button
                  onClick={handleToggleRandom}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    isRandom
                      ? "bg-amber-400/15 text-amber-400 font-semibold ring-1 ring-amber-400/40"
                      : "hover:bg-[var(--accent)]",
                  )}
                  title={isRandom ? "Random pool active — click to disable" : "Use random connection from pool"}
                >
                  <span>🎲 Random</span>
                  {isRandom && <span className="ml-auto text-[0.6875rem]">active</span>}
                </button>
                <div className="mx-2 my-1 h-px bg-[var(--border)]" />
                {sortedConnections.map((conn) => {
                  const inPool = conn.useForRandom === "true";
                  const isActive = activeConnectionId === conn.id;
                  if (isRandom) {
                    return (
                      <button
                        key={conn.id}
                        onClick={() => handleTogglePool(conn.id, inPool)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                        title={inPool ? "In random pool — click to remove" : "Click to add to random pool"}
                      >
                        <span className="flex-1 truncate">{conn.name || conn.id}</span>
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            inPool
                              ? "border-amber-400/60 bg-amber-400/20 text-amber-400"
                              : "border-[var(--border)] bg-transparent",
                          )}
                        >
                          {inPool && <Check size="0.625rem" strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={conn.id}
                      onClick={() => handleSwitchConnection(conn.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]",
                        isActive && "text-foreground font-semibold",
                      )}
                    >
                      <span className="flex-1 truncate">{conn.name || conn.id}</span>
                      {isActive && <span className="text-[0.6875rem]">✓</span>}
                    </button>
                  );
                })}
                {sortedConnections.length === 0 && (
                  <div className="px-3 py-4 text-center text-[0.6875rem] italic text-[var(--muted-foreground)]">
                    No connections found.
                  </div>
                )}
              </>
            )}

            {tab === "personas" && (
              <>
                <button
                  onClick={() => handleSwitchPersona(null)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                    !activePersonaId && "text-foreground",
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
                    ?
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("text-xs font-semibold", !activePersonaId && "text-foreground")}>None</span>
                    <span className="text-[0.625rem] text-[var(--muted-foreground)]">No persona selected</span>
                  </div>
                  {!activePersonaId && <span className="ml-auto text-[0.6875rem]">✓</span>}
                </button>
                <div className="mx-2 my-1 h-px bg-[var(--border)]" />
                {groups.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const firstMember = group.members[0];
                  const hasActiveInGroup = group.members.some((p) => p.id === activePersonaId);
                  return (
                    <div key={group.id}>
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                          hasActiveInGroup && "text-foreground",
                        )}
                      >
                        {firstMember?.avatarPath ? (
                          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-[var(--border)]">
                            <img
                              src={firstMember.avatarPath}
                              alt={group.name}
                              className="h-full w-full object-cover"
                              style={getAvatarCropStyle(parseAvatarCropJson(firstMember.avatarCrop))}
                            />
                          </div>
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
                            {group.name[0].toUpperCase()}
                          </div>
                        )}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1 text-xs font-semibold">
                            {isExpanded ? (
                              <FolderOpen size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                            ) : (
                              <Folder size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                            )}
                            {group.name} ({group.members.length})
                          </span>
                          <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                            {group.members.length} persona{group.members.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="ml-auto shrink-0 text-[var(--muted-foreground)]">
                          {isExpanded ? <ChevronDown size="0.875rem" /> : <ChevronRight size="0.875rem" />}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="ml-2 border-l border-[var(--border)]/50 pl-1">
                          {group.members.map((persona) => renderPersonaRow(persona, true))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ungrouped.map((persona) => renderPersonaRow(persona, false))}
                {sortedPersonas.length === 0 && (
                  <div className="px-3 py-4 text-center text-[0.6875rem] italic text-[var(--muted-foreground)]">
                    No personas found.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
