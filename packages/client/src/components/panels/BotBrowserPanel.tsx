// ──────────────────────────────────────────────
// Panel: Browser (sidebar — shows imported characters)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCharacters } from "../../hooks/use-characters";
import { useCreateChat, chatKeys } from "../../hooks/use-chats";
import { useChatPresets, useApplyChatPreset } from "../../hooks/use-chat-presets";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { api } from "../../lib/api-client";
import { Search, User, Globe, Wand2, MessageCircle } from "lucide-react";
import { cn, getAvatarCropStyle } from "../../lib/utils";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

type CharacterRow = { id: string; data: string; avatarPath: string | null; createdAt: string; updatedAt: string };

export function BotBrowserPanel() {
  const { data: characters, isLoading } = useCharacters();
  const openCharacterDetail = useUIStore((s) => s.openCharacterDetail);
  const openBotBrowser = useUIStore((s) => s.openBotBrowser);
  const botBrowserOpen = useUIStore((s) => s.botBrowserOpen);
  const createChat = useCreateChat();
  const queryClient = useQueryClient();
  const { data: chatPresetsData } = useChatPresets();
  const applyChatPreset = useApplyChatPreset();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    charId: string;
    charName: string;
    firstMes?: string;
    altGreetings?: string[];
  } | null>(null);

  const parsed = useMemo(() => {
    if (!characters) return [];
    return (characters as CharacterRow[]).reduce<
      { id: string; name: string; avatarPath: string | null; createdAt: string }[]
    >((acc, c) => {
      const d = JSON.parse(c.data);
      if (d.extensions?.botBrowserSource) {
        acc.push({ id: c.id, name: d.name ?? "Unnamed", avatarPath: c.avatarPath, createdAt: c.createdAt });
      }
      return acc;
    }, []);
  }, [characters]);

  const filtered = useMemo(() => {
    if (!search) return parsed;
    const q = search.toLowerCase();
    return parsed.filter((c) => c.name.toLowerCase().includes(q));
  }, [parsed, search]);

  const getCharacterGreeting = useCallback(
    (charId: string): { firstMes?: string; altGreetings: string[] } => {
      const raw = (characters as CharacterRow[] | undefined)?.find((c) => c.id === charId);
      if (!raw) return { altGreetings: [] };
      try {
        const d = JSON.parse(raw.data) as { first_mes?: string; alternate_greetings?: string[] };
        return { firstMes: d.first_mes, altGreetings: d.alternate_greetings ?? [] };
      } catch {
        return { altGreetings: [] };
      }
    },
    [characters],
  );

  const quickStartFromCharacter = useCallback(
    (
      charId: string,
      charName: string,
      mode: "roleplay" | "conversation",
      firstMes?: string,
      altGreetings?: string[],
    ) => {
      const label = mode === "conversation" ? "Conversation" : "Roleplay";
      // Resolve the user's starred default preset for this mode (if any other than the built-in Default).
      const presets = chatPresetsData ?? [];
      const presetMode = mode === "conversation" ? "conversation" : "roleplay";
      const starred = presets.find((p) => p.mode === presetMode && p.isActive && !p.isDefault);
      createChat.mutate(
        { name: charName ? `${charName} — ${label}` : `New ${label}`, mode, characterIds: [charId] },
        {
          onSuccess: async (chat) => {
            useChatStore.getState().setActiveChatId(chat.id);
            // Apply the user's starred default preset to the brand-new chat so its
            // settings start where the user wants them.
            if (starred) {
              try {
                await applyChatPreset.mutateAsync({ presetId: starred.id, chatId: chat.id });
              } catch {
                /* non-fatal — the chat still opens with system defaults */
              }
            }
            // Mirror the wizard's roleplay first-message behavior so the
            // character actually greets the user in the new chat.
            if (mode === "roleplay" && firstMes?.trim()) {
              try {
                const msg = await api.post<{ id: string }>(`/chats/${chat.id}/messages`, {
                  role: "assistant",
                  content: firstMes,
                  characterId: charId,
                });
                if (msg?.id && altGreetings?.length) {
                  for (const greeting of altGreetings) {
                    if (greeting.trim()) {
                      await api.post(`/chats/${chat.id}/messages/${msg.id}/swipes`, {
                        content: greeting,
                        silent: true,
                      });
                    }
                  }
                }
                queryClient.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
              } catch {
                /* swallow — don't block the chat from opening if greeting injection fails */
              }
            }
            useChatStore.getState().setShouldOpenSettings(true);
            useChatStore.getState().setShouldOpenWizard(true);
            useChatStore.getState().setShouldOpenWizardInShortcutMode(true);
          },
        },
      );
    },
    [createChat, queryClient, chatPresetsData, applyChatPreset],
  );

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Browse online button */}
      <button
        onClick={openBotBrowser}
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
          botBrowserOpen
            ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
            : "bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[var(--accent)]",
        )}
      >
        <Globe size="0.875rem" />
        Browse Online
      </button>

      {/* Search */}
      <div className="relative">
        <Search size="0.75rem" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search imported..."
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] py-1.5 pl-7 pr-3 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition-colors focus:border-[var(--primary)]"
        />
      </div>

      {/* Character list */}
      {isLoading ? (
        <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">
          {search ? "No matches" : "No imported characters yet"}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {filtered.map((char) => (
            <button
              key={char.id}
              onClick={() => openCharacterDetail(char.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                const greeting = getCharacterGreeting(char.id);
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  charId: char.id,
                  charName: char.name,
                  firstMes: greeting.firstMes,
                  altGreetings: greeting.altGreetings,
                });
              }}
              className="group flex items-center gap-2.5 rounded-xl p-2 text-left transition-all hover:bg-[var(--sidebar-accent)]"
            >
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 text-white shadow-sm overflow-hidden">
                {char.avatarPath ? (
                  <img
                    src={char.avatarPath}
                    alt={char.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                    style={getAvatarCropStyle()}
                  />
                ) : (
                  <User size="0.875rem" />
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{char.name}</span>
            </button>
          ))}
        </div>
      )}

      {contextMenu &&
        (() => {
          const items: ContextMenuItem[] = [
            {
              label: "Quick Start Roleplay",
              icon: <Wand2 size="0.75rem" />,
              onSelect: () =>
                quickStartFromCharacter(
                  contextMenu.charId,
                  contextMenu.charName,
                  "roleplay",
                  contextMenu.firstMes,
                  contextMenu.altGreetings,
                ),
            },
            {
              label: "Quick Start Conversation",
              icon: <MessageCircle size="0.75rem" />,
              onSelect: () => quickStartFromCharacter(contextMenu.charId, contextMenu.charName, "conversation"),
            },
          ];
          return <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={() => setContextMenu(null)} />;
        })()}
    </div>
  );
}
