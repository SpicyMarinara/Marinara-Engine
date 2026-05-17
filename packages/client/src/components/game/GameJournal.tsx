// ──────────────────────────────────────────────
// Game: Journal Viewer
//
// Browsable auto-journal panel showing
// NPC notes, locations, inventory, and events —
// all assembled from committed snapshots, no LLM.
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { X, MapPin, Swords, ScrollText, Package, Users, PenLine, BookOpen, Trash2, Loader2, Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { applyInlineMarkdown, renderMarkdownBlocks } from "../../lib/markdown";
import { AnimatedText } from "./AnimatedText";

import type { GameNpc } from "@marinara-engine/shared";

interface JournalEntry {
  timestamp: string;
  type: "location" | "npc" | "combat" | "quest" | "item" | "event" | "note";
  title: string;
  content: string;
  readableType?: "note" | "book";
  sourceMessageId?: string;
  sourceSegmentIndex?: number;
}

interface QuestEntry {
  id: string;
  name: string;
  status: "active" | "completed" | "failed";
  description: string;
  objectives: string[];
}

interface Journal {
  entries: JournalEntry[];
  quests: QuestEntry[];
  locations: string[];
  npcLog: Array<{ npcName: string; interactions: string[] }>;
  inventoryLog: Array<{
    item: string;
    action: "acquired" | "used" | "lost" | "removed";
    quantity: number;
    timestamp: string;
  }>;
}

interface GameJournalProps {
  chatId: string;
  npcs?: GameNpc[];
  onClose: () => void;
  onNpcPortraitClick?: (npcName: string) => void;
  onNpcPortraitGenerate?: (npcName: string) => void;
  npcPortraitGenerationEnabled?: boolean;
  generatingNpcPortraitNames?: Set<string>;
  onNpcRemove?: (npcName: string) => Promise<void> | void;
}

type TabId = "all" | "npcs" | "locations" | "inventory" | "library" | "notes";

const TABS: Array<{ id: TabId; label: string; icon: typeof ScrollText }> = [
  { id: "all", label: "Timeline", icon: ScrollText },
  { id: "npcs", label: "NPCs", icon: Users },
  { id: "locations", label: "Map", icon: MapPin },
  { id: "inventory", label: "Items", icon: Package },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "notes", label: "Notes", icon: PenLine },
];

const TYPE_ICONS: Record<string, typeof ScrollText> = {
  location: MapPin,
  combat: Swords,
  quest: ScrollText,
  item: Package,
  npc: Users,
  event: ScrollText,
  note: ScrollText,
};

function isMobileGameViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

const TRAILING_REPUTATION_LABEL = /(devoted|allied|friendly|neutral|unfriendly|hostile|enemy)$/i;

function normalizeNpcName(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanNpcDisplayName(value: string): string {
  return value.replace(TRAILING_REPUTATION_LABEL, "").trim() || value;
}

function normalizeNpcEntryTitle(value: string): string {
  const title = value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return normalizeNpcName(cleanNpcDisplayName(title));
}

function dedupeNpcInteractions(interactions: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const interaction of interactions) {
    const trimmed = interaction.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function pruneJournalNpc(journal: Journal, npcName: string): Journal {
  const target = normalizeNpcName(cleanNpcDisplayName(npcName));
  return {
    ...journal,
    npcLog: journal.npcLog.filter((entry) => normalizeNpcName(cleanNpcDisplayName(entry.npcName)) !== target),
    entries: journal.entries.filter((entry) => {
      if (entry.type !== "npc") return true;
      const title = entry.title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      return normalizeNpcName(cleanNpcDisplayName(title)) !== target;
    }),
  };
}

function shouldShowNpcDescription(npc: GameNpc): boolean {
  return (npc as GameNpc & { descriptionSource?: string }).descriptionSource === "model" && !!npc.description?.trim();
}

function shouldShowJournalNpc(npc: GameNpc): boolean {
  const source = (npc as GameNpc & { descriptionSource?: string }).descriptionSource;
  const hasReputationChange = Number.isFinite(npc.reputation) && npc.reputation !== 0;
  const hasRelationshipNotes = Array.isArray(npc.notes) && npc.notes.some((note) => !!note.trim());
  return source === "model" || hasReputationChange || hasRelationshipNotes;
}

function isDuplicateInventoryEntry(
  left: { item: string; action: string; quantity: number; timestamp: string },
  right: { item: string; action: string; quantity: number; timestamp: string },
): boolean {
  if (normalizeNpcName(left.item) !== normalizeNpcName(right.item)) return false;
  if (left.action !== right.action || left.quantity !== right.quantity) return false;
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return true;
  return Math.abs(leftTime - rightTime) <= 10_000;
}

function JournalMarkdown({ text, className }: { text: string; className?: string }) {
  const rendered = useMemo(() => renderMarkdownBlocks(text, applyInlineMarkdown, "game-journal"), [text]);
  return <div className={cn("mari-message-content whitespace-pre-wrap", className)}>{rendered}</div>;
}

function dedupeAdjacentInventoryEntries<
  T extends { item: string; action: string; quantity: number; timestamp: string },
>(items: T[]): T[] {
  const deduped: T[] = [];
  for (const item of items) {
    const previous = deduped[deduped.length - 1];
    if (previous && isDuplicateInventoryEntry(previous, item)) continue;
    deduped.push(item);
  }
  return deduped;
}

export function GameJournal({
  chatId,
  npcs,
  onClose,
  onNpcPortraitClick,
  onNpcPortraitGenerate,
  npcPortraitGenerationEnabled = false,
  generatingNpcPortraitNames,
  onNpcRemove,
}: GameJournalProps) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [playerNotes, setPlayerNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(true);
  const [removingNpcName, setRemovingNpcName] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNotesRef = useRef("");

  useEffect(() => {
    api
      .get<{ journal: Journal; playerNotes?: string }>(`/game/${chatId}/journal`)
      .then((res) => {
        setJournal(res.journal);
        if (res.playerNotes) setPlayerNotes(res.playerNotes);
      })
      .catch(() => {});
  }, [chatId]);

  const saveNotes = useCallback(
    (text: string) => {
      api
        .put(`/game/${chatId}/notes`, { notes: text })
        .then(() => setNotesSaved(true))
        .catch(() => {});
    },
    [chatId],
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      setPlayerNotes(text);
      latestNotesRef.current = text;
      setNotesSaved(false);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveNotes(text), 800);
    },
    [saveNotes],
  );

  // Flush unsaved notes on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveNotes(latestNotesRef.current);
      }
    };
  }, [saveNotes]);

  const handleRemoveNpc = useCallback(
    async (npcName: string) => {
      if (!onNpcRemove) return;
      setRemovingNpcName(npcName);
      try {
        await onNpcRemove(npcName);
        setJournal((prev) => (prev ? pruneJournalNpc(prev, npcName) : prev));
      } finally {
        setRemovingNpcName(null);
      }
    },
    [onNpcRemove],
  );

  const journalNpcs = useMemo(() => (npcs ?? []).filter(shouldShowJournalNpc), [npcs]);

  const trackedNpcNames = useMemo(() => {
    const names = new Set<string>();
    for (const npc of journalNpcs) {
      const key = normalizeNpcName(cleanNpcDisplayName(npc.name));
      if (key) names.add(key);
    }
    return names;
  }, [journalNpcs]);

  const visibleEntries = useMemo(
    () =>
      (journal?.entries ?? []).filter(
        (entry) => entry.type !== "npc" || trackedNpcNames.has(normalizeNpcEntryTitle(entry.title)),
      ),
    [journal?.entries, trackedNpcNames],
  );

  if (!journal) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="text-sm text-white/60">Loading journal...</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/85 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-bold text-white/90">📖 Adventure Journal</h2>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs — horizontally scrollable on mobile */}
      <div className="overflow-x-auto border-b border-white/10 px-4 py-2 scrollbar-hide [-webkit-overflow-scrolling:touch]">
        <div className="flex gap-1 w-max min-w-full">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.625rem] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                    : "text-white/50 hover:bg-white/5 hover:text-white/70",
                )}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "all" && <TimelineView entries={visibleEntries} />}
        {activeTab === "npcs" && (
          <NpcsView
            npcLog={journal.npcLog}
            npcs={journalNpcs}
            onNpcPortraitClick={onNpcPortraitClick}
            onNpcPortraitGenerate={onNpcPortraitGenerate}
            npcPortraitGenerationEnabled={npcPortraitGenerationEnabled}
            generatingNpcPortraitNames={generatingNpcPortraitNames}
            onNpcRemove={onNpcRemove ? handleRemoveNpc : undefined}
            removingNpcName={removingNpcName}
          />
        )}
        {activeTab === "locations" && <LocationsView locations={journal.locations} />}
        {activeTab === "inventory" && <InventoryView items={journal.inventoryLog} />}
        {activeTab === "library" && <LibraryView entries={visibleEntries.filter((e) => e.type === "note")} />}
        {activeTab === "notes" && <NotesView notes={playerNotes} onChange={handleNotesChange} saved={notesSaved} />}
      </div>
    </div>
  );
}

function TimelineView({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-center text-xs text-white/40">No journal entries yet.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {[...entries].reverse().map((entry, i) => {
        const Icon = TYPE_ICONS[entry.type] ?? ScrollText;
        return (
          <div key={i} className="flex gap-3 rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Icon size={12} className="text-white/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white/80">{entry.title}</div>
              <AnimatedText html={entry.content} className="mt-0.5 text-[0.625rem] text-white/50" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reputationLabel(rep: number): { text: string; color: string } {
  if (rep >= 50) return { text: "Allied", color: "text-emerald-400" };
  if (rep >= 20) return { text: "Friendly", color: "text-green-400" };
  if (rep >= -20) return { text: "Neutral", color: "text-gray-400" };
  if (rep >= -50) return { text: "Hostile", color: "text-orange-400" };
  return { text: "Enemy", color: "text-red-400" };
}

function NpcsView({
  npcLog,
  npcs,
  onNpcPortraitClick,
  onNpcPortraitGenerate,
  npcPortraitGenerationEnabled,
  generatingNpcPortraitNames,
  onNpcRemove,
  removingNpcName,
}: {
  npcLog: Array<{ npcName: string; interactions: string[] }>;
  npcs?: GameNpc[];
  onNpcPortraitClick?: (npcName: string) => void;
  onNpcPortraitGenerate?: (npcName: string) => void;
  npcPortraitGenerationEnabled?: boolean;
  generatingNpcPortraitNames?: Set<string>;
  onNpcRemove?: (npcName: string) => void;
  removingNpcName?: string | null;
}) {
  const trackedNpcs = npcs ?? [];
  const hasContent = trackedNpcs.length > 0;
  const [mobilePortraitActionsNpc, setMobilePortraitActionsNpc] = useState<string | null>(null);

  const handleNpcPortraitAvatarClick = useCallback(
    (npcName: string) => {
      if (isMobileGameViewport() && onNpcPortraitGenerate && npcPortraitGenerationEnabled === true) {
        const normalizedName = npcName.trim().toLowerCase();
        setMobilePortraitActionsNpc((current) => (current === normalizedName ? null : normalizedName));
        return;
      }

      onNpcPortraitClick?.(npcName);
    },
    [npcPortraitGenerationEnabled, onNpcPortraitClick, onNpcPortraitGenerate],
  );

  if (!hasContent) {
    return <div className="text-center text-xs text-white/40">No NPCs encountered yet.</div>;
  }

  const npcMap = new Map<string, { npc: GameNpc; interactions: string[]; displayName: string; originalName: string }>();
  for (const n of trackedNpcs) {
    const displayName = cleanNpcDisplayName(n.name);
    const key = normalizeNpcName(displayName);
    if (!key) continue;
    npcMap.set(key, { npc: n, interactions: [], displayName, originalName: n.name });
  }
  for (const entry of npcLog) {
    const displayName = cleanNpcDisplayName(entry.npcName);
    const key = normalizeNpcName(displayName);
    if (!key) continue;
    const existing = npcMap.get(key);
    const interactions = dedupeNpcInteractions(entry.interactions);
    if (existing) {
      existing.interactions = dedupeNpcInteractions([...existing.interactions, ...interactions]);
    }
  }
  const entries = [...npcMap.values()].sort((left, right) => {
    const repDelta = Math.abs(right.npc.reputation) - Math.abs(left.npc.reputation);
    if (repDelta !== 0) return repDelta;
    return left.displayName.localeCompare(right.displayName);
  });

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const name = cleanNpcDisplayName(entry.npc.name);
        const rep = reputationLabel(entry.npc.reputation);
        const showReputation = entry.npc.reputation !== 0;
        const canUploadPortrait = !!onNpcPortraitClick;
        const canGeneratePortrait = !!onNpcPortraitGenerate && npcPortraitGenerationEnabled === true;
        const portraitGenerating = generatingNpcPortraitNames?.has(entry.npc.name.trim().toLowerCase()) ?? false;
        const isRemoving = removingNpcName
          ? normalizeNpcName(cleanNpcDisplayName(removingNpcName)) === normalizeNpcName(name)
          : false;
        return (
          <div key={normalizeNpcName(name)} className="rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="flex items-center gap-2">
              {canUploadPortrait ? (
                <div className="group/journal-avatar relative shrink-0">
                  <button
                    type="button"
                    onClick={() => handleNpcPortraitAvatarClick(entry.npc.name)}
                    className="rounded-full transition-transform hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-white/20"
                    title="Upload or replace NPC portrait"
                  >
                    {entry.npc.avatarUrl ? (
                      <img
                        src={entry.npc.avatarUrl}
                        alt={name}
                        className="h-6 w-6 rounded-full object-cover ring-1 ring-white/10 transition-colors hover:ring-white/25"
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-white/60 ring-1 ring-white/10 transition-colors hover:ring-white/25">
                        {name[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </button>
                  {canGeneratePortrait && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onNpcPortraitGenerate?.(entry.npc.name);
                      }}
                      disabled={portraitGenerating}
                      className={cn(
                        "absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[var(--primary)] opacity-0 ring-1 ring-white/15 transition-opacity disabled:cursor-wait md:group-hover/journal-avatar:opacity-100",
                        (portraitGenerating || mobilePortraitActionsNpc === entry.npc.name.trim().toLowerCase()) &&
                          "max-md:opacity-100",
                      )}
                      title="Generate NPC portrait"
                    >
                      {portraitGenerating ? (
                        <Loader2 size="0.6rem" className="animate-spin" />
                      ) : (
                        <Wand2 size="0.6rem" />
                      )}
                    </button>
                  )}
                </div>
              ) : entry.npc.avatarUrl ? (
                <img src={entry.npc.avatarUrl} alt={name} className="h-6 w-6 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-white/60">
                  {name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <span className="flex-1 text-xs font-medium text-white/80">
                {entry.npc.emoji ? `${entry.npc.emoji} ` : ""}
                {name}
              </span>
              {showReputation && <span className={cn("text-[10px] font-medium", rep.color)}>{rep.text}</span>}
              {onNpcRemove && (
                <button
                  type="button"
                  onClick={() => onNpcRemove(entry.originalName)}
                  disabled={isRemoving}
                  title="Remove this NPC from the journal"
                  className="rounded p-1 text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            {shouldShowNpcDescription(entry.npc) && (
              <div className="mt-1 text-[0.6rem] text-white/40">{entry.npc.description}</div>
            )}
            {entry.npc?.location && <div className="mt-0.5 text-[0.6rem] text-white/30">📍 {entry.npc.location}</div>}
          </div>
        );
      })}
    </div>
  );
}

function LocationsView({ locations }: { locations: string[] }) {
  if (locations.length === 0) {
    return <div className="text-center text-xs text-white/40">No locations discovered yet.</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {locations.map((loc, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
          <MapPin size={10} className="text-white/40" />
          <span className="text-xs text-white/70">{loc}</span>
        </div>
      ))}
    </div>
  );
}

function InventoryView({
  items,
}: {
  items: Array<{
    item: string;
    action: "acquired" | "used" | "lost" | "removed";
    quantity: number;
    timestamp: string;
  }>;
}) {
  const visibleItems = dedupeAdjacentInventoryEntries(items);

  if (visibleItems.length === 0) {
    return <div className="text-center text-xs text-white/40">No items in inventory log.</div>;
  }

  const actionColors: Record<string, string> = {
    acquired: "text-emerald-400",
    used: "text-amber-400",
    lost: "text-red-400",
    removed: "text-red-300",
  };

  return (
    <div className="flex flex-col gap-1">
      {[...visibleItems].reverse().map((item, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-1.5"
        >
          <span className="text-xs text-white/70">
            {item.quantity > 1 ? `${item.quantity}x ` : ""}
            {item.item}
          </span>
          <span className={cn("text-[0.625rem] font-medium", actionColors[item.action])}>{item.action}</span>
        </div>
      ))}
    </div>
  );
}

function LibraryView({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-center text-xs text-white/40">No books or notes found yet.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {[...entries].reverse().map((entry, i) => {
        const isBook = entry.readableType === "book" || entry.title.toLowerCase() === "book";
        const text = entry.content;
        return (
          <div key={i} className="rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <BookOpen size={11} className={isBook ? "text-amber-400/70" : "text-blue-400/70"} />
              <span
                className={cn(
                  "text-[0.625rem] font-semibold uppercase tracking-wide",
                  isBook ? "text-amber-400/70" : "text-blue-400/70",
                )}
              >
                {isBook ? "Book" : "Note"}
              </span>
              <span className="ml-auto text-[0.5625rem] text-white/30">{entry.timestamp}</span>
            </div>
            <JournalMarkdown text={text} className="mt-1.5 text-xs leading-relaxed text-white/70" />
          </div>
        );
      })}
    </div>
  );
}

function NotesView({ notes, onChange, saved }: { notes: string; onChange: (text: string) => void; saved: boolean }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[0.625rem] text-white/40">
          Your personal notes — visible to the Game Master and party members.
        </p>
        <span
          className={cn("text-[0.5625rem] transition-opacity", saved ? "text-emerald-400/60" : "text-amber-400/60")}
        >
          {saved ? "Saved" : "Saving..."}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-2">
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your notes here... track clues, plans, NPC names, theories — anything you want to remember."
          className="min-h-44 resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-xs leading-relaxed text-white/80 outline-none placeholder:text-white/25 focus:border-white/20 md:min-h-0"
          spellCheck={false}
        />
        <div className="min-h-44 overflow-auto rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 md:min-h-0">
          {notes.trim() ? (
            <JournalMarkdown text={notes} className="text-xs leading-relaxed text-white/75" />
          ) : (
            <div className="text-xs text-white/30">Nothing written yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
