// ──────────────────────────────────────────────
// Chat: Settings Drawer — per-chat configuration
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Users,
  BookOpen,
  Sliders,
  Plug,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Wrench,
  Search,
  MessageSquare,
  Sparkles,
  Image,
  Pencil,
  GripVertical,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { ChoiceSelectionModal } from "../presets/ChoiceSelectionModal";
import { useCharacters, useCharacterSprites, usePersonas } from "../../hooks/use-characters";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { usePresets } from "../../hooks/use-presets";
import { useConnections } from "../../hooks/use-connections";
import { useUpdateChat, useUpdateChatMetadata, useChat, useCreateMessage } from "../../hooks/use-chats";
import { useUIStore } from "../../stores/ui.store";
import type { Chat } from "@marinara-engine/shared";

interface ChatSettingsDrawerProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
}

export function ChatSettingsDrawer({ chat, open, onClose }: ChatSettingsDrawerProps) {
  const updateChat = useUpdateChat();
  const updateMeta = useUpdateChatMetadata();
  const createMessage = useCreateMessage(chat.id);

  const { data: allCharacters } = useCharacters();
  const { data: lorebooks } = useLorebooks();
  const { data: presets } = usePresets();
  const { data: connections } = useConnections();
  const { data: allPersonas } = usePersonas();
  const personas = (allPersonas ?? []) as Array<{ id: string; name: string; avatarPath: string | null }>;

  const chatCharIds: string[] =
    typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);

  const metadata = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
  const activeLorebookIds: string[] = metadata.activeLorebookIds ?? [];
  const spriteCharacterIds: string[] = metadata.spriteCharacterIds ?? [];
  const spritePosition: "left" | "right" = metadata.spritePosition ?? "left";

  // ── Helpers ──
  const characters = (allCharacters ?? []) as Array<{
    id: string;
    data: string;
    avatarPath: string | null;
  }>;

  // Memoize character name parsing — avoids repeated JSON.parse per render
  const charNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of characters) {
      try {
        const p = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
        map.set(c.id, (p as { name?: string }).name ?? "Unknown");
      } catch {
        map.set(c.id, "Unknown");
      }
    }
    return map;
  }, [characters]);

  const charName = (c: { id?: string; data: string }) => {
    if (c.id && charNameMap.has(c.id)) return charNameMap.get(c.id)!;
    try {
      const p = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
      return (p as { name?: string }).name ?? "Unknown";
    } catch {
      return "Unknown";
    }
  };

  // ── Mutations ──
  const toggleCharacter = (charId: string) => {
    const current = [...chatCharIds];
    const idx = current.indexOf(charId);
    if (idx >= 0) {
      current.splice(idx, 1);
      updateChat.mutate({ id: chat.id, characterIds: current });
    } else {
      current.push(charId);
      updateChat.mutate(
        { id: chat.id, characterIds: current },
        {
          onSuccess: () => {
            // Check if the added character has a first message
            const char = characters.find((c) => c.id === charId);
            if (!char) return;
            try {
              const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
              const firstMes = (parsed as { first_mes?: string }).first_mes;
              if (firstMes && window.confirm(`Add ${charName(char)}'s first message to the chat?`)) {
                createMessage.mutate({ role: "assistant", content: firstMes, characterId: charId });
              }
            } catch {
              /* ignore parse errors */
            }
          },
        },
      );
    }
  };

  const toggleSprite = (charId: string) => {
    const current = [...spriteCharacterIds];
    const idx = current.indexOf(charId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      if (current.length >= 3) return; // max 3
      current.push(charId);
    }
    updateMeta.mutate({ id: chat.id, spriteCharacterIds: current });
  };

  // ── Character drag-and-drop reordering ──
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleCharDragStart = (idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleCharDragOver = (cardIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropIdx(e.clientY < midY ? cardIdx : cardIdx + 1);
  };

  const handleCharDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragIdx;
    const tgt = dropIdx;
    setDragIdx(null);
    setDropIdx(null);
    if (src === null || tgt === null) return;
    let insertAt = tgt;
    if (src < insertAt) insertAt--;
    if (src === insertAt) return;
    const ids = [...chatCharIds];
    const [moved] = ids.splice(src, 1);
    ids.splice(insertAt, 0, moved!);
    updateChat.mutate({ id: chat.id, characterIds: ids });
  };

  const handleCharDragEnd = () => {
    setDragIdx(null);
    setDropIdx(null);
  };

  const toggleLorebook = (lbId: string) => {
    const current = [...activeLorebookIds];
    const idx = current.indexOf(lbId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(lbId);
    updateMeta.mutate({ id: chat.id, activeLorebookIds: current });
  };

  const setPreset = (presetId: string | null) => {
    updateChat.mutate(
      { id: chat.id, promptPresetId: presetId },
      {
        onSuccess: () => {
          if (presetId) setChoiceModalPresetId(presetId);
        },
      },
    );
  };

  const setConnection = (connectionId: string | null) => {
    updateChat.mutate({ id: chat.id, connectionId });
  };

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(chat.name);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [showLbPicker, setShowLbPicker] = useState(false);
  const [charSearch, setCharSearch] = useState("");
  const [lbSearch, setLbSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);

  const saveName = () => {
    if (nameVal.trim() && nameVal !== chat.name) {
      updateChat.mutate({ id: chat.id, name: nameVal.trim() });
    }
    setEditingName(false);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">Chat Settings</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Chat Name */}
          <Section label="Chat Name">
            {editingName ? (
              <div className="flex gap-2">
                <input
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                  autoFocus
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--primary)]/40"
                />
                <button onClick={saveName} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs text-white">
                  <Check size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNameVal(chat.name);
                  setEditingName(true);
                }}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
              >
                {chat.name}
              </button>
            )}
          </Section>

          {/* Connection */}
          <Section
            label="Connection"
            icon={<Plug size={14} />}
            help="Which AI provider and model to use for this chat. 'Random' picks a different connection each time from your random pool."
          >
            <select
              value={chat.connectionId ?? ""}
              onChange={(e) => setConnection(e.target.value || null)}
              className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            >
              <option value="">None</option>
              <option value="random">🎲 Random</option>
              {((connections ?? []) as Array<{ id: string; name: string }>).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {chat.connectionId === "random" && (
              <p className="mt-1.5 text-[10px] text-amber-400/80">
                Each generation will randomly pick from connections marked for the random pool.
              </p>
            )}
          </Section>

          {/* Persona */}
          <Section
            label="Persona"
            icon={<Users size={14} />}
            help="Your persona defines who you are in this chat. The AI will address you by this persona's name and use its details for context."
          >
            <select
              value={chat.personaId ?? ""}
              onChange={(e) => updateChat.mutate({ id: chat.id, personaId: e.target.value || null })}
              className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
            >
              <option value="">None</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Section>

          {/* Characters — only show added ones + add button */}
          <Section
            label="Characters"
            icon={<Users size={14} />}
            count={chatCharIds.length}
            help="Characters in this chat. Each character has their own personality that the AI roleplays as."
          >
            {/* Active characters */}
            {chatCharIds.length === 0 ? (
              <p className="text-[11px] text-[var(--muted-foreground)]">No characters added to this chat.</p>
            ) : (
              <div
                className="flex flex-col gap-1"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropIdx(chatCharIds.length);
                }}
                onDrop={handleCharDrop}
              >
                {chatCharIds.map((cid, i) => {
                  const c = characters.find((ch) => ch.id === cid);
                  if (!c) return null;
                  const name = charName(c);
                  const spriteActive = spriteCharacterIds.includes(c.id);
                  return (
                    <div key={c.id}>
                      {dropIdx === i && dragIdx !== null && dragIdx !== i && (
                        <div className="h-0.5 rounded-full bg-[var(--primary)] mx-2 mb-1" />
                      )}
                      <div
                        draggable
                        onDragStart={(e) => handleCharDragStart(i, e)}
                        onDragOver={(e) => {
                          e.stopPropagation();
                          handleCharDragOver(i, e);
                        }}
                        onDragEnd={handleCharDragEnd}
                        className={cn(
                          "flex items-center gap-2 rounded-lg bg-[var(--primary)]/10 px-2 py-2 ring-1 ring-[var(--primary)]/30 transition-opacity",
                          dragIdx === i && "opacity-40",
                        )}
                      >
                        <div
                          className="cursor-grab text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors active:cursor-grabbing"
                          title="Drag to reorder"
                        >
                          <GripVertical size={12} />
                        </div>
                        <button
                          onClick={() => {
                            onClose();
                            useUIStore.getState().openCharacterDetail(c.id);
                          }}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left transition-colors hover:opacity-80"
                          title="Open character card"
                        >
                          {c.avatarPath ? (
                            <img src={c.avatarPath} alt={name} className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold">
                              {name[0]}
                            </div>
                          )}
                          <span className="flex-1 truncate text-xs">{name}</span>
                        </button>
                        <SpriteToggleButton
                          characterId={c.id}
                          active={spriteActive}
                          disabled={!spriteActive && spriteCharacterIds.length >= 3}
                          onToggle={() => toggleSprite(c.id)}
                        />
                        <button
                          onClick={() => toggleCharacter(c.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove from chat"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {dropIdx === chatCharIds.length && dragIdx !== null && (
                  <div className="h-0.5 rounded-full bg-[var(--primary)] mx-2 mt-1" />
                )}
              </div>
            )}

            {/* Sprite position — only show if any sprites enabled */}
            {spriteCharacterIds.length > 0 && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2">
                <Image size={12} className="text-[var(--muted-foreground)]" />
                <span className="flex-1 text-[11px] text-[var(--muted-foreground)]">Sprite Side</span>
                <div className="flex rounded-md ring-1 ring-[var(--border)]">
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, spritePosition: "left" })}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-medium transition-colors rounded-l-md",
                      spritePosition === "left"
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    Left
                  </button>
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, spritePosition: "right" })}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-medium transition-colors rounded-r-md",
                      spritePosition === "right"
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    Right
                  </button>
                </div>
              </div>
            )}

            {/* Add character picker */}
            {!showCharPicker ? (
              <button
                onClick={() => {
                  setShowCharPicker(true);
                  setCharSearch("");
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <Plus size={12} /> Add Character
              </button>
            ) : (
              <PickerDropdown
                search={charSearch}
                onSearchChange={setCharSearch}
                onClose={() => setShowCharPicker(false)}
                placeholder="Search characters…"
              >
                {characters
                  .filter((c) => !chatCharIds.includes(c.id))
                  .filter((c) => charName(c).toLowerCase().includes(charSearch.toLowerCase()))
                  .map((c) => {
                    const name = charName(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          toggleCharacter(c.id);
                          setShowCharPicker(false);
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                      >
                        {c.avatarPath ? (
                          <img src={c.avatarPath} alt={name} className="h-6 w-6 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold">
                            {name[0]}
                          </div>
                        )}
                        <span className="flex-1 truncate text-xs">{name}</span>
                        <Plus size={12} className="text-[var(--muted-foreground)]" />
                      </button>
                    );
                  })}
                {characters
                  .filter((c) => !chatCharIds.includes(c.id))
                  .filter((c) => charName(c).toLowerCase().includes(charSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                    {characters.filter((c) => !chatCharIds.includes(c.id)).length === 0
                      ? "All characters already added."
                      : "No matches."}
                  </p>
                )}
              </PickerDropdown>
            )}
          </Section>

          {/* Group Chat Settings — only when 2+ characters */}
          {chatCharIds.length > 1 && (
            <Section
              label="Group Chat"
              icon={<Users size={14} />}
              help="Configure how multiple characters interact. Merged mode combines all characters into one narrator; Individual mode has each character respond separately."
            >
              {/* Mode selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Mode</label>
                <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, groupChatMode: "merged" })}
                    className={cn(
                      "flex-1 px-3 py-2 text-[11px] font-medium transition-colors rounded-l-lg",
                      (metadata.groupChatMode ?? "merged") === "merged"
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    Merged (Narrator)
                  </button>
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, groupChatMode: "individual" })}
                    className={cn(
                      "flex-1 px-3 py-2 text-[11px] font-medium transition-colors rounded-r-lg",
                      metadata.groupChatMode === "individual"
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    Individual
                  </button>
                </div>
              </div>

              {/* Merged mode: speaker color option */}
              {(metadata.groupChatMode ?? "merged") === "merged" && (
                <div className="mt-2">
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, groupSpeakerColors: !metadata.groupSpeakerColors })}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      metadata.groupSpeakerColors
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div>
                      <span className="text-[11px] font-medium">Color Dialogues</span>
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        Color character dialogues differently using speaker tags
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                        metadata.groupSpeakerColors ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          metadata.groupSpeakerColors && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                </div>
              )}

              {/* Individual mode: response order */}
              {metadata.groupChatMode === "individual" && (
                <div className="mt-2 space-y-2">
                  <label className="text-[11px] font-medium text-[var(--muted-foreground)]">Response Order</label>
                  <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "sequential" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[11px] font-medium transition-colors rounded-l-lg",
                        (metadata.groupResponseOrder ?? "sequential") === "sequential"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      All (Sequential)
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "smart" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[11px] font-medium transition-colors rounded-r-lg",
                        metadata.groupResponseOrder === "smart"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Smart (Scene-aware)
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    {(metadata.groupResponseOrder ?? "sequential") === "sequential"
                      ? "Characters respond one by one in their listed order."
                      : "An AI agent decides which characters should respond based on the scene context."}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* Lorebooks — only show active ones + add button */}
          <Section
            label="Lorebooks"
            icon={<BookOpen size={14} />}
            count={activeLorebookIds.length}
            help="Lorebooks contain world info, character backstories, and lore that gets injected into the AI's context when relevant keywords appear."
          >
            {/* Active lorebooks */}
            {activeLorebookIds.length === 0 ? (
              <p className="text-[11px] text-[var(--muted-foreground)]">No lorebooks added to this chat.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeLorebookIds.map((lbId) => {
                  const lb = (lorebooks ?? []).find((l: { id: string }) => l.id === lbId) as
                    | { id: string; name: string }
                    | undefined;
                  if (!lb) return null;
                  return (
                    <div
                      key={lb.id}
                      className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                    >
                      <BookOpen size={14} className="text-[var(--primary)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <button
                        onClick={() => toggleLorebook(lb.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                        title="Remove from chat"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add lorebook picker */}
            {!showLbPicker ? (
              <button
                onClick={() => {
                  setShowLbPicker(true);
                  setLbSearch("");
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <Plus size={12} /> Add Lorebook
              </button>
            ) : (
              <PickerDropdown
                search={lbSearch}
                onSearchChange={setLbSearch}
                onClose={() => setShowLbPicker(false)}
                placeholder="Search lorebooks…"
              >
                {((lorebooks ?? []) as Array<{ id: string; name: string }>)
                  .filter((lb) => !activeLorebookIds.includes(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase()))
                  .map((lb) => (
                    <button
                      key={lb.id}
                      onClick={() => {
                        toggleLorebook(lb.id);
                        setShowLbPicker(false);
                      }}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                    >
                      <BookOpen size={14} className="text-[var(--muted-foreground)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <Plus size={12} className="text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                {((lorebooks ?? []) as Array<{ id: string; name: string }>)
                  .filter((lb) => !activeLorebookIds.includes(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                    {((lorebooks ?? []) as Array<{ id: string }>).filter((lb) => !activeLorebookIds.includes(lb.id))
                      .length === 0
                      ? "All lorebooks already added."
                      : "No matches."}
                  </p>
                )}
              </PickerDropdown>
            )}
          </Section>

          {/* Preset */}
          <Section
            label="Prompt Preset"
            icon={<Sliders size={14} />}
            help="Presets control how the system prompt is structured and what generation parameters are used. Different presets produce different AI behaviors."
          >
            <div className="flex items-center gap-1.5">
              <select
                value={chat.promptPresetId ?? ""}
                onChange={(e) => setPreset(e.target.value || null)}
                className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
              >
                <option value="">None</option>
                {((presets ?? []) as Array<{ id: string; name: string; isDefault?: boolean | string }>).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isDefault === true || p.isDefault === "true" ? "Default" : p.name}
                  </option>
                ))}
              </select>
              {chat.promptPresetId && (
                <button
                  onClick={() => setChoiceModalPresetId(chat.promptPresetId!)}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  title="Edit preset variables"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          </Section>

          {/* Function Calling / Tool Use */}
          <Section
            label="Function Calling"
            icon={<Wrench size={14} />}
            help="When enabled, the AI can call built-in tools like dice rolls, game state updates, and lorebook searches during conversation."
          >
            <div className="space-y-2">
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, enableTools: !metadata.enableTools });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.enableTools
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Enable Tool Use</span>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Allow AI to call functions (dice rolls, game state, etc.)
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    metadata.enableTools ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.enableTools && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
              {metadata.enableTools && (
                <p className="text-[10px] text-[var(--muted-foreground)] px-1">
                  Uses all functions enabled in the <strong>Functions</strong> tab.
                </p>
              )}
            </div>
          </Section>

          {/* Agents */}
          <Section
            label="Agents"
            icon={<Sparkles size={14} />}
            help="When enabled, AI agents run automatically during generation to enrich the chat with world state tracking, expression detection, and more."
          >
            <div className="space-y-2">
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, enableAgents: !metadata.enableAgents });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.enableAgents
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Enable Agents</span>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Run AI agents during generation (world state, expressions, etc.)
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    metadata.enableAgents ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.enableAgents && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
              {metadata.enableAgents && (
                <p className="text-[10px] text-[var(--muted-foreground)] px-1">
                  Uses all agents enabled in the <strong>Agents</strong> tab.
                </p>
              )}
            </div>
          </Section>

          {/* Context Message Limit */}
          <Section
            label="Context Limit"
            icon={<MessageSquare size={14} />}
            help="Limit how many messages are included in the context sent to the AI model. When off, all messages are sent (up to the model's context window). When on, only the last N messages are included."
          >
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (metadata.contextMessageLimit) {
                    updateMeta.mutate({ id: chat.id, contextMessageLimit: null });
                  } else {
                    updateMeta.mutate({ id: chat.id, contextMessageLimit: 50 });
                  }
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.contextMessageLimit
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Limit Context Messages</span>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Only send the last N messages to the model
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    metadata.contextMessageLimit ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.contextMessageLimit && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
              {metadata.contextMessageLimit && (
                <div className="flex items-center gap-2 px-1">
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={metadata.contextMessageLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) {
                        updateMeta.mutate({ id: chat.id, contextMessageLimit: val });
                      }
                    }}
                    className="w-20 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <span className="text-[10px] text-[var(--muted-foreground)]">messages</span>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Choice selection modal for preset variables */}
      {choiceModalPresetId && (
        <ChoiceSelectionModal
          open={!!choiceModalPresetId}
          onClose={() => setChoiceModalPresetId(null)}
          presetId={choiceModalPresetId}
          chatId={chat.id}
          existingChoices={metadata.presetChoices ?? {}}
        />
      )}
    </>
  );
}

// ── Reusable section wrapper ──
function Section({
  label,
  icon,
  count,
  help,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  count?: number;
  help?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-[var(--border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {icon && <span className="text-[var(--muted-foreground)]">{icon}</span>}
        <span className="flex-1 text-xs font-semibold">{label}</span>
        {help && (
          <span onClick={(e) => e.stopPropagation()}>
            <HelpTooltip text={help} side="left" />
          </span>
        )}
        {count != null && count > 0 && (
          <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)]">
            {count}
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── Picker dropdown (for adding characters / lorebooks) ──
function PickerDropdown({
  search,
  onSearchChange,
  onClose,
  placeholder,
  children,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  onClose: () => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="mt-2 rounded-lg ring-1 ring-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Search size={12} className="text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X size={12} />
        </button>
      </div>
      {/* List */}
      <div className="max-h-48 overflow-y-auto">{children}</div>
    </div>
  );
}

// ── Sprite toggle button (per character) ──
// Uses the hook internally so we can conditionally render based on whether sprites exist.
function SpriteToggleButton({
  characterId,
  active,
  disabled,
  onToggle,
}: {
  characterId: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { data: sprites } = useCharacterSprites(characterId);
  const hasSprites = Array.isArray(sprites) && sprites.length > 0;

  if (!hasSprites) return null;

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-md transition-colors",
        active
          ? "text-[var(--primary)] hover:bg-[var(--primary)]/15"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
        disabled && "opacity-30 cursor-not-allowed",
      )}
      title={active ? "Hide sprite" : disabled ? "Max 3 sprites" : "Show sprite"}
    >
      <Image size={11} />
    </button>
  );
}
