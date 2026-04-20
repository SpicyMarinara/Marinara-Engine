// ──────────────────────────────────────────────
// Chat: Settings Drawer — per-chat configuration
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  X,
  Users,
  User,
  BookOpen,
  Sliders,
  Plug,
  ChevronDown,
  ChevronRight,
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
  MessageCircle,
  Bot,
  CalendarClock,
  RefreshCw,
  Settings2,
  Link,
  ArrowRightLeft,
  Unlink,
  Brain,
  Globe,
  Maximize2,
  Languages,
  Vibrate,
  LetterText,
  Feather,
  Activity,
  Puzzle,
  Save,
  FilePlus2,
  Upload,
  Download,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { ExpandedTextarea } from "../ui/ExpandedTextarea";
import { ChoiceSelectionModal } from "../presets/ChoiceSelectionModal";
import { SummariesEditorModal } from "./SummariesEditorModal";
import { useCharacters, useCharacterSprites, usePersonas, useCharacterGroups } from "../../hooks/use-characters";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { usePresets } from "../../hooks/use-presets";
import { useConnections, useSaveConnectionDefaults } from "../../hooks/use-connections";
import {
  useUpdateChat,
  useUpdateChatMetadata,
  useCreateMessage,
  useChats,
  useConnectChat,
  useDisconnectChat,
  chatKeys,
} from "../../hooks/use-chats";
import { api } from "../../lib/api-client";
import { useUIStore } from "../../stores/ui.store";
import {
  useChatPresets,
  useSaveChatPresetSettings,
  useDuplicateChatPreset,
  useUpdateChatPreset,
  useDeleteChatPreset,
  useApplyChatPreset,
  useImportChatPreset,
} from "../../hooks/use-chat-presets";
import type { ChatMode, ChatPreset, ChatPresetSettings } from "@marinara-engine/shared";
import { useAgentConfigs, type AgentConfigRow } from "../../hooks/use-agents";
import { BUILT_IN_AGENTS, BUILT_IN_TOOLS } from "@marinara-engine/shared";
import type { Chat, CharacterGroup } from "@marinara-engine/shared";
import { useCustomTools, type CustomToolRow } from "../../hooks/use-custom-tools";
import { useHapticStatus, useHapticConnect, useHapticDisconnect, useHapticStartScan } from "../../hooks/use-haptic";
import { normalizeSpritePlacements } from "./sprite-placement";

interface ChatSettingsDrawerProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  spriteArrangeMode?: boolean;
  onToggleSpriteArrange?: () => void;
  onResetSpritePlacements?: () => void;
  onSpriteSideChange?: (side: "left" | "right") => void;
}

// Agents that should not be manually added to roleplay chats
const HIDDEN_ROLEPLAY_AGENTS = new Set([
  "prompt-reviewer",
  "schedule-planner",
  "response-orchestrator",
  "autonomous-messenger",
]);

export function ChatSettingsDrawer({
  chat,
  open,
  onClose,
  spriteArrangeMode = false,
  onToggleSpriteArrange,
  onResetSpritePlacements,
  onSpriteSideChange,
}: ChatSettingsDrawerProps) {
  const qc = useQueryClient();
  const updateChat = useUpdateChat();
  const updateMeta = useUpdateChatMetadata();
  const createMessage = useCreateMessage(chat.id);
  const connectChat = useConnectChat();
  const disconnectChat = useDisconnectChat();

  const { data: allCharacters } = useCharacters();
  const { data: characterGroups } = useCharacterGroups();
  const { data: lorebooks } = useLorebooks();
  const { data: presets } = usePresets();
  const { data: connections } = useConnections();
  const imageConnectionsList = useMemo(
    () =>
      ((connections as Array<{ id: string; name: string; model?: string; provider?: string }>) ?? []).filter(
        (c) => c.provider === "image_generation",
      ),
    [connections],
  );
  const { data: allPersonas } = usePersonas();
  const { data: agentConfigs } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const { data: allChats } = useChats();
  const personas = (allPersonas ?? []) as Array<{
    id: string;
    name: string;
    comment: string;
    avatarPath: string | null;
  }>;

  const chatCharIds: string[] = useMemo(
    () => (typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? [])),
    [chat.characterIds],
  );

  const metadata = useMemo(
    () => (typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {})),
    [chat.metadata],
  );
  const chatMode = (chat as unknown as { mode?: string }).mode ?? "roleplay";
  const isConversation = chatMode === "conversation";
  const isGame = chatMode === "game";
  const activeLorebookIds: string[] = metadata.activeLorebookIds ?? [];
  const activeAgentIds: string[] = metadata.activeAgentIds ?? [];
  const activeToolIds: string[] = metadata.activeToolIds ?? [];
  const spriteCharacterIds: string[] = Array.isArray(metadata.spriteCharacterIds) ? metadata.spriteCharacterIds : [];
  const spritePosition: "left" | "right" = metadata.spritePosition === "right" ? "right" : "left";
  const hasCustomSpritePlacements = Object.keys(normalizeSpritePlacements(metadata.spritePlacements)).length > 0;

  // Build the available agent list: built-in + custom agents from DB
  // In roleplay mode, hide agents that are either automatic or handled internally.
  const availableAgents = useMemo(() => {
    const agents: Array<{ id: string; name: string; description: string; category: string }> = [];
    for (const a of BUILT_IN_AGENTS) {
      if (HIDDEN_ROLEPLAY_AGENTS.has(a.id)) continue;
      agents.push({ id: a.id, name: a.name, description: a.description, category: a.category });
    }
    // Custom agents from DB
    if (agentConfigs) {
      for (const c of agentConfigs as AgentConfigRow[]) {
        if (!BUILT_IN_AGENTS.some((b) => b.id === c.type)) {
          agents.push({ id: c.type, name: c.name, description: c.description, category: "custom" });
        }
      }
    }
    return agents;
  }, [agentConfigs]);

  // Build the available tool list: built-in + custom tools from DB
  const availableTools = useMemo(() => {
    const tools: Array<{ id: string; name: string; description: string }> = [];
    for (const t of BUILT_IN_TOOLS) {
      tools.push({ id: t.name, name: t.name, description: t.description });
    }
    if (customTools) {
      for (const ct of customTools as CustomToolRow[]) {
        if (ct.enabled === "true" || ct.enabled === "1") {
          tools.push({ id: ct.name, name: ct.name, description: ct.description });
        }
      }
    }
    return tools;
  }, [customTools]);

  // ── Helpers ──
  const characters = useMemo(
    () =>
      (allCharacters ?? []) as Array<{
        id: string;
        data: string;
        avatarPath: string | null;
      }>,
    [allCharacters],
  );

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

  // ── First message confirm state ──
  const [firstMesConfirm, setFirstMesConfirm] = useState<{
    charId: string;
    charName: string;
    message: string;
    alternateGreetings: string[];
  } | null>(null);

  const handleFirstMesConfirm = useCallback(async () => {
    if (!firstMesConfirm) return;
    const msg = await createMessage.mutateAsync({
      role: "assistant",
      content: firstMesConfirm.message,
      characterId: firstMesConfirm.charId,
    });
    // Add alternate greetings as swipes on the first message
    if (msg?.id && firstMesConfirm.alternateGreetings.length > 0) {
      for (const greeting of firstMesConfirm.alternateGreetings) {
        if (greeting.trim()) {
          await api.post(`/chats/${chat.id}/messages/${msg.id}/swipes`, { content: greeting, silent: true });
        }
      }
      qc.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
    }
    setFirstMesConfirm(null);
  }, [firstMesConfirm, createMessage, chat.id, qc]);

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
            // Skip auto-greeting for conversation mode
            if (isConversation) return;
            const char = characters.find((c) => c.id === charId);
            if (!char) return;
            try {
              const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
              const firstMes = (parsed as { first_mes?: string }).first_mes;
              const altGreetings = (parsed as { alternate_greetings?: string[] }).alternate_greetings ?? [];
              if (firstMes) {
                setFirstMesConfirm({
                  charId,
                  charName: charName(char),
                  message: firstMes,
                  alternateGreetings: altGreetings,
                });
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

  const setSpriteSide = useCallback(
    (nextSide: "left" | "right") => {
      if (nextSide === spritePosition) return;
      if (onSpriteSideChange) {
        onSpriteSideChange(nextSide);
        return;
      }
      updateMeta.mutate({ id: chat.id, spritePosition: nextSide });
    },
    [chat.id, onSpriteSideChange, spritePosition, updateMeta],
  );

  const resetSpritePlacements = useCallback(() => {
    if (onResetSpritePlacements) {
      onResetSpritePlacements();
      return;
    }
    updateMeta.mutate({ id: chat.id, spritePlacements: {} });
  }, [chat.id, onResetSpritePlacements, updateMeta]);

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

  const toggleAgent = (agentId: string) => {
    const current = [...activeAgentIds];
    const idx = current.indexOf(agentId);
    const isRemoving = idx >= 0;
    if (isRemoving) current.splice(idx, 1);
    else current.push(agentId);
    updateMeta.mutate({ id: chat.id, activeAgentIds: current });

    // When removing an agent that stores persistent memory, clean it up
    if (isRemoving && agentId === "secret-plot-driver") {
      api.delete(`/agents/memory/${agentId}/${chat.id}`).catch(() => {});
    }
  };

  const toggleTool = (toolId: string) => {
    const current = [...activeToolIds];
    const idx = current.indexOf(toolId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(toolId);
    updateMeta.mutate({ id: chat.id, activeToolIds: current });
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

  const setPartyConnection = (connectionId: string | null) => {
    updateMeta.mutate({ id: chat.id, gameCharacterConnectionId: connectionId });
  };

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(chat.name);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showLbPicker, setShowLbPicker] = useState(false);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);
  const [showSummariesModal, setShowSummariesModal] = useState(false);
  const [connectionSearch, setConnectionSearch] = useState("");
  const [personaSearch, setPersonaSearch] = useState("");
  const [pendingToolIds, setPendingToolIds] = useState<string[]>([]);
  const [charSearch, setCharSearch] = useState("");
  const [lbSearch, setLbSearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);
  const [scenePromptExpanded, setScenePromptExpanded] = useState(false);
  const [scenePromptDraft, setScenePromptDraft] = useState(metadata.sceneSystemPrompt ?? "");
  const [groupScenarioDraft, setGroupScenarioDraft] = useState((metadata.groupScenarioText as string) ?? "");
  const [groupScenarioExpanded, setGroupScenarioExpanded] = useState(false);
  const [gameAgentPool] = useState<string[]>(() => Array.from(new Set(activeAgentIds)));
  const [extraPromptDraft, setExtraPromptDraft] = useState((metadata.gameExtraPrompt as string) ?? "");
  const [extraPromptExpanded, setExtraPromptExpanded] = useState(false);

  // ── Chat Settings Presets ──
  const presetMode = (chatMode === "visual_novel" ? "roleplay" : chatMode) as ChatMode;
  const { data: chatPresets } = useChatPresets(presetMode);
  const saveChatPreset = useSaveChatPresetSettings();
  const duplicateChatPreset = useDuplicateChatPreset();
  const renameChatPreset = useUpdateChatPreset();
  const deleteChatPreset = useDeleteChatPreset();
  const applyChatPreset = useApplyChatPreset();
  const importChatPreset = useImportChatPreset();
  const presetList = useMemo(() => (chatPresets ?? []) as ChatPreset[], [chatPresets]);
  const appliedPresetId = (metadata.appliedChatPresetId as string | undefined) ?? null;
  const selectedChatPreset = useMemo(() => {
    if (appliedPresetId) {
      const match = presetList.find((p) => p.id === appliedPresetId);
      if (match) return match;
    }
    return presetList.find((p) => p.isDefault) ?? null;
  }, [presetList, appliedPresetId]);
  const [renamingPreset, setRenamingPreset] = useState(false);
  const [renamePresetVal, setRenamePresetVal] = useState("");
  const presetFileInputRef = useRef<HTMLInputElement | null>(null);

  const snapshotCurrentPresetSettings = useCallback((): ChatPresetSettings => {
    return {
      connectionId: chat.connectionId ?? null,
      promptPresetId: chat.promptPresetId ?? null,
      metadata: { ...metadata },
    };
  }, [chat.connectionId, chat.promptPresetId, metadata]);

  const handleSelectPreset = (id: string) => {
    if (!id || id === selectedChatPreset?.id) return;
    applyChatPreset.mutate({ presetId: id, chatId: chat.id });
  };

  const handleSaveIntoPreset = () => {
    if (!selectedChatPreset || selectedChatPreset.isDefault) return;
    saveChatPreset.mutate({ id: selectedChatPreset.id, settings: snapshotCurrentPresetSettings() });
  };

  const handleStartRenamePreset = () => {
    if (!selectedChatPreset || selectedChatPreset.isDefault) return;
    setRenamePresetVal(selectedChatPreset.name);
    setRenamingPreset(true);
  };

  const handleCommitRenamePreset = () => {
    if (!selectedChatPreset || selectedChatPreset.isDefault) {
      setRenamingPreset(false);
      return;
    }
    const next = renamePresetVal.trim();
    if (next && next !== selectedChatPreset.name) {
      renameChatPreset.mutate({ id: selectedChatPreset.id, name: next });
    }
    setRenamingPreset(false);
  };

  const handleSaveAsPreset = () => {
    if (!selectedChatPreset) return;
    const baseName = window.prompt("Name for the new preset:", `${selectedChatPreset.name} Copy`);
    if (!baseName?.trim()) return;
    const trimmed = baseName.trim().slice(0, 120);
    duplicateChatPreset.mutate(
      { id: selectedChatPreset.id, name: trimmed },
      {
        onSuccess: (created) => {
          if (!created) return;
          // Save the current chat settings into the new preset, then apply it
          // (which records appliedChatPresetId on the chat so the dropdown follows).
          saveChatPreset.mutate(
            { id: created.id, settings: snapshotCurrentPresetSettings() },
            {
              onSuccess: () => applyChatPreset.mutate({ presetId: created.id, chatId: chat.id }),
            },
          );
        },
      },
    );
  };

  const handleDeletePreset = () => {
    if (!selectedChatPreset || selectedChatPreset.isDefault) return;
    const ok = window.confirm(`Delete preset "${selectedChatPreset.name}"? This cannot be undone.`);
    if (!ok) return;
    const wasApplied = selectedChatPreset.id === appliedPresetId;
    const defaultPreset = presetList.find((p) => p.isDefault);
    deleteChatPreset.mutate(selectedChatPreset.id, {
      onSuccess: () => {
        // If the chat was using the preset we just deleted, fall back to the
        // Default preset's settings — without this, the chat would visually
        // show "Default" but keep the deleted preset's actual values.
        if (wasApplied && defaultPreset) {
          applyChatPreset.mutate({ presetId: defaultPreset.id, chatId: chat.id });
        }
      },
    });
  };

  const handleExportPreset = () => {
    if (!selectedChatPreset) return;
    api.download(
      `/chat-presets/${selectedChatPreset.id}/export`,
      `${selectedChatPreset.name}.marinara-chat-preset.json`,
    );
  };

  const handleImportClick = () => {
    presetFileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      const created = await importChatPreset.mutateAsync(envelope);
      if (created?.id) applyChatPreset.mutate({ presetId: created.id, chatId: chat.id });
    } catch (err) {
      window.alert(`Failed to import preset: ${err instanceof Error ? err.message : "Invalid file"}`);
    }
  };

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
      <div className="absolute right-0 top-0 z-50 flex h-full w-80 max-md:w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up max-md:pt-[env(safe-area-inset-top)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">Chat Settings</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>

        {/* Chat Settings Preset bar — hidden in Game Mode (not designed for it) */}
        {!isGame && (
          <div className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3">
            <input
              ref={presetFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            {/* Dropdown / rename input + help */}
            <div className="flex items-center gap-2">
              {renamingPreset ? (
                <input
                  value={renamePresetVal}
                  onChange={(e) => setRenamePresetVal(e.target.value)}
                  onBlur={handleCommitRenamePreset}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitRenamePreset();
                    else if (e.key === "Escape") setRenamingPreset(false);
                  }}
                  autoFocus
                  maxLength={120}
                  className="flex-1 min-w-0 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-[var(--primary)]/40"
                />
              ) : (
                <select
                  value={selectedChatPreset?.id ?? ""}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  title="Apply a chat-settings preset to this chat"
                  className="flex-1 min-w-0 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                >
                  {presetList.length === 0 && <option value="">Loading…</option>}
                  {presetList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.isDefault ? "Default" : p.name}
                    </option>
                  ))}
                </select>
              )}
              <HelpTooltip
                side="left"
                text="Presets bundle this chat's connection, prompt preset, agents, tools, translation, memory recall, advanced parameters, and other settings. They never touch your characters, persona, lorebooks, sprites, summary, tags, or scene prompt — those stay tied to the chat."
              />
            </div>
            {/* Single row of all preset actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleSaveIntoPreset}
                disabled={!selectedChatPreset || selectedChatPreset.isDefault}
                title={
                  selectedChatPreset?.isDefault
                    ? "Cannot save into the Default preset"
                    : "Save current chat settings into this preset"
                }
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size="0.875rem" />
              </button>
              <button
                onClick={handleStartRenamePreset}
                disabled={!selectedChatPreset || selectedChatPreset.isDefault}
                title={selectedChatPreset?.isDefault ? "Cannot rename the Default preset" : "Rename preset"}
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pencil size="0.875rem" />
              </button>
              <button
                onClick={handleSaveAsPreset}
                disabled={!selectedChatPreset}
                title="Save current chat settings as a new preset"
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FilePlus2 size="0.875rem" />
              </button>
              <span className="mx-1 h-4 w-px shrink-0 bg-[var(--border)]" aria-hidden />
              <button
                onClick={handleImportClick}
                title="Import preset (.json)"
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <Upload size="0.875rem" />
              </button>
              <button
                onClick={handleExportPreset}
                disabled={!selectedChatPreset}
                title="Export preset (.json)"
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size="0.875rem" />
              </button>
              <button
                onClick={handleDeletePreset}
                disabled={!selectedChatPreset || selectedChatPreset.isDefault}
                title={selectedChatPreset?.isDefault ? "Cannot delete the Default preset" : "Delete preset"}
                className="flex-1 flex items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size="0.875rem" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Chat Name */}
          <Section
            label="Chat Name"
            icon={<LetterText size="0.875rem" />}
            help="This name is only visible to you — it won't be sent to the AI or affect the conversation in any way."
          >
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
                  <Check size="0.75rem" />
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
            icon={<Plug size="0.875rem" />}
            help={
              isGame
                ? "Separate AI models for the Game Master (narration, world, NPCs) and the Party chat (inter-character banter)."
                : "Which AI provider and model to use for this chat. 'Random' picks a different connection each time from your random pool."
            }
          >
            {isGame ? (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    GM Model
                  </label>
                  <select
                    value={chat.connectionId ?? ""}
                    onChange={(e) => setConnection(e.target.value || null)}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">None</option>
                    <option value="random">🎲 Random</option>
                    {((connections ?? []) as Array<{ id: string; name: string; model?: string }>).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.model ? ` — ${c.model}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    Party AI Model
                  </label>
                  <select
                    value={(metadata.gameCharacterConnectionId as string) ?? ""}
                    onChange={(e) => setPartyConnection(e.target.value || null)}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">Same as GM</option>
                    {((connections ?? []) as Array<{ id: string; name: string; model?: string }>).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.model ? ` — ${c.model}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
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
                  <p className="mt-1.5 text-[0.625rem] text-amber-400/80">
                    Each generation will randomly pick from connections marked for the random pool.
                  </p>
                )}
              </>
            )}
          </Section>

          {/* Preset — hidden for conversation mode and game mode */}
          {!isConversation && !isGame && !metadata.sceneSystemPrompt && (
            <Section
              label="Prompt Preset"
              icon={<Sliders size="0.875rem" />}
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
                    <Pencil size="0.8125rem" />
                  </button>
                )}
              </div>
            </Section>
          )}

          {/* Extra Prompt — game mode only */}
          {isGame && (
            <Section
              label="Extra Prompt"
              icon={<Feather size="0.875rem" />}
              help="Additional instructions added to game generation prompts. Use this to suggest a writing style, ban themes, request specific behaviors, etc. Does not affect scene analysis."
            >
              <div className="space-y-1.5">
                <div className="relative">
                  <textarea
                    value={extraPromptDraft}
                    onChange={(e) => setExtraPromptDraft(e.target.value)}
                    onBlur={() => {
                      const stored = (metadata.gameExtraPrompt as string) ?? "";
                      if (extraPromptDraft !== stored) {
                        updateMeta.mutate({ id: chat.id, gameExtraPrompt: extraPromptDraft || null });
                      }
                    }}
                    placeholder="e.g. Write in a poetic, literary style. Avoid graphic violence. Always describe the weather..."
                    rows={5}
                    className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <button
                    onClick={() => setExtraPromptExpanded(true)}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Expand editor"
                  >
                    <Maximize2 size="0.75rem" />
                  </button>
                </div>
                <p className="text-[0.5625rem] text-[var(--muted-foreground)]/70 px-0.5">
                  {extraPromptDraft ? "Custom instructions active" : "No extra instructions set"}
                </p>
                {extraPromptDraft && (
                  <button
                    onClick={() => {
                      setExtraPromptDraft("");
                      updateMeta.mutate({ id: chat.id, gameExtraPrompt: null });
                    }}
                    className="rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
                  >
                    Clear
                  </button>
                )}
              </div>
              <ExpandedTextarea
                open={extraPromptExpanded}
                onClose={() => {
                  setExtraPromptExpanded(false);
                  const stored = (metadata.gameExtraPrompt as string) ?? "";
                  if (extraPromptDraft !== stored) {
                    updateMeta.mutate({ id: chat.id, gameExtraPrompt: extraPromptDraft || null });
                  }
                }}
                title="Extra Prompt"
                value={extraPromptDraft}
                onChange={setExtraPromptDraft}
                placeholder="Additional instructions for game generation..."
              />
            </Section>
          )}

          {/* Scene System Prompt — shown only for scene-created chats */}
          {metadata.sceneSystemPrompt && (
            <Section
              label="Scene Instructions"
              icon={<Sparkles size="0.875rem" />}
              help="The system prompt generated for this scene. You can edit it to change the AI's writing style, POV, tone, and focus."
            >
              <div className="relative">
                <textarea
                  value={scenePromptDraft}
                  onChange={(e) => setScenePromptDraft(e.target.value)}
                  onBlur={() => {
                    if (scenePromptDraft !== metadata.sceneSystemPrompt) {
                      updateMeta.mutate({ id: chat.id, sceneSystemPrompt: scenePromptDraft });
                    }
                  }}
                  placeholder="Scene system prompt..."
                  rows={6}
                  className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                />
                <button
                  onClick={() => setScenePromptExpanded(true)}
                  className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  title="Expand editor"
                >
                  <Maximize2 size="0.75rem" />
                </button>
              </div>
              <ExpandedTextarea
                open={scenePromptExpanded}
                onClose={() => {
                  setScenePromptExpanded(false);
                  if (scenePromptDraft !== metadata.sceneSystemPrompt) {
                    updateMeta.mutate({ id: chat.id, sceneSystemPrompt: scenePromptDraft });
                  }
                }}
                title="Scene Instructions"
                value={scenePromptDraft}
                onChange={setScenePromptDraft}
                placeholder="Scene system prompt..."
              />
            </Section>
          )}

          {/* Party (game mode) */}
          {isGame && (
            <Section
              label="Party"
              icon={<Users size="0.875rem" />}
              count={chatCharIds.length + (chat.personaId ? 1 : 0)}
              help="Your in-game party. Pick a persona to play as and manage which characters join the adventure."
            >
              <div className="space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Persona</label>
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
              </div>

              <div className="mt-2 space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Party Characters</label>
                {chatCharIds.length === 0 ? (
                  <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No characters in party yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {chatCharIds.map((cid) => {
                      const c = characters.find((ch) => ch.id === cid);
                      if (!c) return null;
                      const name = charName(c);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                        >
                          <span className="flex-1 truncate text-xs">{name}</span>
                          <button
                            onClick={() => toggleCharacter(c.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                            title="Remove from party"
                          >
                            <Trash2 size="0.6875rem" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!showCharPicker ? (
                <button
                  onClick={() => {
                    setShowCharPicker(true);
                    setCharSearch("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Add Character to Party
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
                          <span className="flex-1 truncate text-xs">{name}</span>
                          <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                        </button>
                      );
                    })}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Persona */}
          {!isGame && (
            <Section
              label="Persona"
              icon={<Users size="0.875rem" />}
              help="Your persona defines who you are in this chat. The AI will address you by this persona's name and use its details for context."
            >
              {/* Currently selected persona */}
              {chat.personaId ? (
                <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-2.5 py-2">
                  {(() => {
                    const p = personas.find((p) => p.id === chat.personaId);
                    return p ? (
                      <>
                        {p.avatarPath ? (
                          <img
                            src={p.avatarPath}
                            alt={p.name}
                            loading="lazy"
                            className="h-7 w-7 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                            <User size="0.75rem" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{p.name}</span>
                          {p.comment && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {p.comment}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="flex-1 truncate text-xs text-[var(--muted-foreground)]">Unknown persona</span>
                    );
                  })()}
                  <button
                    onClick={() => updateChat.mutate({ id: chat.id, personaId: null })}
                    className="ml-auto shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    title="Remove persona"
                  >
                    <X size="0.75rem" />
                  </button>
                </div>
              ) : (
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No persona selected.</p>
              )}

              {/* Persona picker */}
              {!showPersonaPicker ? (
                <button
                  onClick={() => {
                    setShowPersonaPicker(true);
                    setPersonaSearch("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> {chat.personaId ? "Change" : "Choose"} Persona
                </button>
              ) : (
                <PickerDropdown
                  search={personaSearch}
                  onSearchChange={setPersonaSearch}
                  onClose={() => setShowPersonaPicker(false)}
                  placeholder="Search personas..."
                >
                  {/* None option */}
                  <button
                    onClick={() => {
                      updateChat.mutate({ id: chat.id, personaId: null });
                      setShowPersonaPicker(false);
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                      !chat.personaId && "bg-[var(--primary)]/10",
                    )}
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--muted-foreground)]">
                      <X size="0.625rem" />
                    </div>
                    <span className="flex-1 truncate text-xs">None</span>
                    {!chat.personaId && <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />}
                  </button>
                  {personas
                    .filter(
                      (p) =>
                        p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                        (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                    )
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          updateChat.mutate({ id: chat.id, personaId: p.id });
                          setShowPersonaPicker(false);
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                          chat.personaId === p.id && "bg-[var(--primary)]/10",
                        )}
                      >
                        {p.avatarPath ? (
                          <img
                            src={p.avatarPath}
                            alt={p.name}
                            loading="lazy"
                            className="h-6 w-6 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                            <User size="0.625rem" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{p.name}</span>
                          {p.comment && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {p.comment}
                            </span>
                          )}
                        </div>
                        {chat.personaId === p.id && (
                          <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />
                        )}
                      </button>
                    ))}
                  {personas.filter(
                    (p) =>
                      p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                      (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                  ).length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {personas.length === 0 ? "No personas created yet." : "No matches."}
                    </p>
                  )}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Characters — only show added ones + add button */}
          {!isGame && (
            <Section
              label="Characters"
              icon={<Users size="0.875rem" />}
              count={chatCharIds.length}
              help="Characters in this chat. Each character has their own personality that the AI roleplays as."
            >
              {/* Active characters */}
              {chatCharIds.length === 0 ? (
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No characters added to this chat.</p>
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
                            <GripVertical size="0.75rem" />
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
                              <img
                                src={c.avatarPath}
                                alt={name}
                                loading="lazy"
                                className="h-7 w-7 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
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
                            <Trash2 size="0.6875rem" />
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

              {/* Sprite layout — only show if any sprites enabled */}
              {spriteCharacterIds.length > 0 && (
                <div className="mt-2 rounded-lg bg-[var(--secondary)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Image size="0.75rem" className="text-[var(--muted-foreground)]" />
                    <span className="flex-1 text-[0.6875rem] text-[var(--muted-foreground)]">Sprite Layout</span>
                    <button
                      onClick={() => onToggleSpriteArrange?.()}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors ring-1 ring-[var(--border)]",
                        spriteArrangeMode
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      {spriteArrangeMode ? "Done" : "Arrange"}
                    </button>
                    <button
                      onClick={resetSpritePlacements}
                      disabled={!hasCustomSpritePlacements}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors ring-1 ring-[var(--border)]",
                        hasCustomSpritePlacements
                          ? "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                          : "cursor-not-allowed opacity-40 text-[var(--muted-foreground)]",
                      )}
                    >
                      Reset
                    </button>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Default Side</span>
                    <div className="flex rounded-md ring-1 ring-[var(--border)]">
                      <button
                        onClick={() => setSpriteSide("left")}
                        className={cn(
                          "px-2.5 py-1 text-[0.625rem] font-medium transition-colors rounded-l-md",
                          spritePosition === "left"
                            ? "bg-[var(--primary)] text-white"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                        )}
                      >
                        Left
                      </button>
                      <button
                        onClick={() => setSpriteSide("right")}
                        className={cn(
                          "px-2.5 py-1 text-[0.625rem] font-medium transition-colors rounded-r-md",
                          spritePosition === "right"
                            ? "bg-[var(--primary)] text-white"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                        )}
                      >
                        Right
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]">
                    Arrange mode lets you drag sprites anywhere in the chat area. Reset clears saved positions. Changing
                    the side flips the current layout.
                  </p>
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
                  <Plus size="0.75rem" /> Add Character
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
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                              {name[0]}
                            </div>
                          )}
                          <span className="flex-1 truncate text-xs">{name}</span>
                          <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                        </button>
                      );
                    })}
                  {characters
                    .filter((c) => !chatCharIds.includes(c.id))
                    .filter((c) => charName(c).toLowerCase().includes(charSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {characters.filter((c) => !chatCharIds.includes(c.id)).length === 0
                        ? "All characters already added."
                        : "No matches."}
                    </p>
                  )}
                </PickerDropdown>
              )}

              {/* Add from Group picker */}
              {((characterGroups ?? []) as CharacterGroup[]).length > 0 &&
                (!showGroupPicker ? (
                  <button
                    onClick={() => setShowGroupPicker(true)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                  >
                    <Users size="0.75rem" /> Add from Group
                  </button>
                ) : (
                  <PickerDropdown
                    search=""
                    onSearchChange={() => {}}
                    onClose={() => setShowGroupPicker(false)}
                    placeholder="Select a group…"
                  >
                    {((characterGroups ?? []) as CharacterGroup[]).map((group) => {
                      const rawIds = group.characterIds ?? [];
                      const groupCharIds: string[] = Array.isArray(rawIds)
                        ? rawIds
                        : typeof rawIds === "string"
                          ? JSON.parse(rawIds)
                          : [];
                      const newIds = groupCharIds.filter((id) => !chatCharIds.includes(id));
                      return (
                        <button
                          key={group.id}
                          onClick={() => {
                            if (newIds.length > 0) {
                              updateChat.mutate({ id: chat.id, characterIds: [...chatCharIds, ...newIds] });
                            }
                            setShowGroupPicker(false);
                          }}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                        >
                          {group.avatarPath ? (
                            <img
                              src={group.avatarPath}
                              alt={group.name}
                              loading="lazy"
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                              {group.name[0]}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block truncate text-xs">{group.name}</span>
                            <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                              {groupCharIds.length} characters
                              {newIds.length > 0 ? ` (· ${newIds.length} new)` : " (all added)"}
                            </span>
                          </div>
                          {newIds.length > 0 && <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                        </button>
                      );
                    })}
                  </PickerDropdown>
                ))}
            </Section>
          )}

          {/* Group Chat Settings — only when 2+ characters, roleplay only (conversations always use merged, game mode handles it internally) */}
          {chatCharIds.length > 1 && !isConversation && !isGame && (
            <Section
              label="Group Chat"
              icon={<Users size="0.875rem" />}
              help="Configure how multiple characters interact. Merged mode combines all characters into one narrator; Individual mode has each character respond separately."
            >
              {/* Mode selector */}
              <div className="space-y-2">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Mode</label>
                <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, groupChatMode: "merged" })}
                    className={cn(
                      "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-l-lg",
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
                      "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-r-lg",
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
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.6875rem] font-medium">Color Dialogues</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Color character dialogues differently using the special tags. The colors are assigned based on
                        what you chose in the Color tab for your Character.
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        metadata.groupSpeakerColors ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
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
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Response Order</label>
                  <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "sequential" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-l-lg",
                        (metadata.groupResponseOrder ?? "sequential") === "sequential"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Sequential
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "smart" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors",
                        metadata.groupResponseOrder === "smart"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Smart
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "manual" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-r-lg",
                        metadata.groupResponseOrder === "manual"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Manual
                    </button>
                  </div>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    {metadata.groupResponseOrder === "manual"
                      ? "No automatic responses — use the character picker in the input bar to trigger responses one at a time."
                      : metadata.groupResponseOrder === "smart"
                        ? "An AI agent decides which characters should respond based on the scene context."
                        : "Characters respond one by one in their listed order."}
                  </p>
                </div>
              )}

              {/* Scenario Override */}
              <div className="mt-2 space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Scenario Override</label>
                <div className="relative">
                  <textarea
                    value={groupScenarioDraft}
                    onChange={(e) => setGroupScenarioDraft(e.target.value)}
                    onBlur={() => {
                      if (groupScenarioDraft !== (metadata.groupScenarioText ?? "")) {
                        updateMeta.mutate({ id: chat.id, groupScenarioText: groupScenarioDraft });
                      }
                    }}
                    placeholder="Replace individual character scenarios with a shared scenario for this group chat or leave empty to keep them…"
                    rows={4}
                    className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <button
                    onClick={() => setGroupScenarioExpanded(true)}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Expand editor"
                  >
                    <Maximize2 size="0.75rem" />
                  </button>
                </div>
                <ExpandedTextarea
                  open={groupScenarioExpanded}
                  onClose={() => {
                    setGroupScenarioExpanded(false);
                    if (groupScenarioDraft !== (metadata.groupScenarioText ?? "")) {
                      updateMeta.mutate({ id: chat.id, groupScenarioText: groupScenarioDraft });
                    }
                  }}
                  title="Group Scenario Override"
                  value={groupScenarioDraft}
                  onChange={setGroupScenarioDraft}
                  placeholder="Replace individual character scenarios with a shared scenario for this group chat or leave empty to keep them…"
                />
              </div>
            </Section>
          )}

          {/* Autonomous Messaging — conversation mode only */}
          {isConversation && (
            <Section
              label="Autonomous Messaging"
              icon={<Bot size="0.875rem" />}
              help="Characters can message you unprompted based on their personality and schedule. Chatty characters will reach out sooner when you're inactive."
            >
              <div className="space-y-2">
                {/* Enable autonomous messages toggle */}
                <button
                  onClick={() => {
                    updateMeta.mutate({ id: chat.id, autonomousMessages: !metadata.autonomousMessages });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    metadata.autonomousMessages
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Autonomous Messages</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Characters message you when you&apos;re inactive
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      metadata.autonomousMessages ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        metadata.autonomousMessages && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                {/* Character exchanges toggle (group chats only) */}
                {chatCharIds.length > 1 && (
                  <button
                    onClick={() => {
                      updateMeta.mutate({ id: chat.id, characterExchanges: !metadata.characterExchanges });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      metadata.characterExchanges
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">Character Exchanges</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Characters chat with each other in group chats
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        metadata.characterExchanges ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          metadata.characterExchanges && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {/* Selfie Connection — connection picker for character selfies */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Image size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Selfie Connection</span>
                  </div>
                  <select
                    value={(metadata.imageGenConnectionId as string) ?? ""}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, imageGenConnectionId: e.target.value || null })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">None (selfies disabled)</option>
                    {((connections ?? []) as Array<{ id: string; name: string; provider: string }>).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.provider})
                      </option>
                    ))}
                  </select>
                  <p className="text-[0.55rem] text-[var(--muted-foreground)]">
                    Used for character selfies. The Illustrator agent uses its own connection from the Agents tab.
                  </p>

                  {/* Selfie resolution picker */}
                  {(metadata.imageGenConnectionId as string) && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Resolution</span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: "512×512", w: 512, h: 512 },
                          { label: "512×768", w: 512, h: 768 },
                          { label: "768×768", w: 768, h: 768 },
                          { label: "768×1024", w: 768, h: 1024 },
                          { label: "1024×1024", w: 1024, h: 1024 },
                        ].map((opt) => {
                          const current = (metadata.selfieResolution as string) ?? "512x768";
                          const val = `${opt.w}x${opt.h}`;
                          const active = current === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => updateMeta.mutate({ id: chat.id, selfieResolution: val })}
                              className={`rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors ${
                                active
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Selfie tags */}
                  {(metadata.imageGenConnectionId as string) && (
                    <SelfieTagsEditor
                      tags={(metadata.selfieTags as string[]) ?? []}
                      onChange={(tags) => updateMeta.mutate({ id: chat.id, selfieTags: tags })}
                    />
                  )}
                </div>

                {/* Schedule status */}
                <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2.5">
                  <CalendarClock size="0.875rem" className="text-[var(--muted-foreground)]" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]">
                      {metadata.characterSchedules
                        ? "Schedules generated — status is derived from character routines."
                        : "Schedules will be generated when you start chatting."}
                    </span>
                    <p className="text-[0.59375rem] text-[var(--muted-foreground)]/60 mt-0.5">
                      Schedules are auto-generated each week.
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api.post("/conversation/schedule/generate", {
                          chatId: chat.id,
                          characterIds: chatCharIds,
                          forceRefresh: true,
                        });
                        // Refresh chat data to pick up new schedules
                        qc.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
                      } catch {
                        // non-critical
                      }
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Regenerate schedules"
                  >
                    <RefreshCw size="0.6875rem" />
                    Regenerate
                  </button>
                </div>

                {/* Schedule editor per character */}
                {metadata.characterSchedules && (
                  <ScheduleEditor
                    characterSchedules={metadata.characterSchedules}
                    chatCharIds={chatCharIds}
                    charNameMap={charNameMap}
                    onSave={(updated) => {
                      updateMeta.mutate({ id: chat.id, characterSchedules: updated });
                    }}
                  />
                )}
              </div>
            </Section>
          )}

          {/* Cross-Chat Awareness — conversation mode only */}
          {isConversation && (
            <Section
              label="Cross-Chat Awareness"
              icon={<Link size="0.875rem" />}
              help="Characters remember and reference conversations from other chats they're in. Pulls recent messages from sibling chats and injects them as context."
            >
              <button
                onClick={() => {
                  updateMeta.mutate({
                    id: chat.id,
                    crossChatAwareness: metadata.crossChatAwareness === false ? true : false,
                  });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.crossChatAwareness !== false
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">Cross-Chat Awareness</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Characters know what happens in their other chats
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.crossChatAwareness !== false ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.crossChatAwareness !== false && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </Section>
          )}

          {/* Connected Roleplay — conversation mode: link to a roleplay chat */}
          {isConversation && (
            <Section
              label="Connected Roleplay"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this conversation to a roleplay chat. OOC context flows between them — conversation characters can influence the roleplay, and roleplay characters can comment in the conversation."
            >
              {chat.connectedChatId ? (
                (() => {
                  const linked = (allChats ?? []).find((c: Chat) => c.id === chat.connectedChatId);
                  return (
                    <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                      <ArrowRightLeft size="0.875rem" className="text-[var(--primary)]" />
                      <div className="flex-1 min-w-0">
                        <span className="truncate text-xs font-medium">{linked?.name ?? "Unknown chat"}</span>
                        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                          {linked ? (linked.mode === "roleplay" ? "Roleplay" : linked.mode) : "Deleted"}
                        </p>
                      </div>
                      <button
                        onClick={() => disconnectChat.mutate(chat.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                        title="Disconnect"
                      >
                        <Unlink size="0.6875rem" />
                      </button>
                    </div>
                  );
                })()
              ) : !showConnectionPicker ? (
                <button
                  onClick={() => {
                    setShowConnectionPicker(true);
                    setConnectionSearch("");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Link to Roleplay
                </button>
              ) : (
                <PickerDropdown
                  search={connectionSearch}
                  onSearchChange={setConnectionSearch}
                  onClose={() => setShowConnectionPicker(false)}
                  placeholder="Search roleplay or game chats…"
                >
                  {((allChats ?? []) as Chat[])
                    .filter(
                      (c) =>
                        c.id !== chat.id &&
                        (c.mode === "roleplay" || c.mode === "game") &&
                        !c.connectedChatId &&
                        c.name.toLowerCase().includes(connectionSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          connectChat.mutate({ chatId: chat.id, targetChatId: c.id });
                          setShowConnectionPicker(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                      >
                        <MessageSquare size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Connected Conversation — roleplay/game mode: show linked OOC chat */}
          {!isConversation && chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="This chat is linked to a conversation. OOC influences from that chat will be injected into context, and game events or roleplay moments can flow back."
            >
              {(() => {
                const linked = (allChats ?? []).find((c: Chat) => c.id === chat.connectedChatId);
                return (
                  <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                    <MessageCircle size="0.875rem" className="text-[var(--primary)]" />
                    <div className="flex-1 min-w-0">
                      <span className="truncate text-xs font-medium">{linked?.name ?? "Unknown chat"}</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">Conversation</p>
                    </div>
                    <button
                      onClick={() => disconnectChat.mutate(chat.id)}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                      title="Disconnect"
                    >
                      <Unlink size="0.6875rem" />
                    </button>
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Connect to Conversation — game mode without existing link */}
          {chatMode === "game" && !chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this game to an OOC conversation. Game events can flow to the conversation and player discussions can influence the game."
            >
              {!showConnectionPicker ? (
                <button
                  onClick={() => {
                    setShowConnectionPicker(true);
                    setConnectionSearch("");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Link to Conversation
                </button>
              ) : (
                <PickerDropdown
                  search={connectionSearch}
                  onSearchChange={setConnectionSearch}
                  onClose={() => setShowConnectionPicker(false)}
                  placeholder="Search conversation chats…"
                >
                  {((allChats ?? []) as Chat[])
                    .filter(
                      (c) =>
                        c.id !== chat.id &&
                        c.mode === "conversation" &&
                        !c.connectedChatId &&
                        c.name.toLowerCase().includes(connectionSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          connectChat.mutate({ chatId: chat.id, targetChatId: c.id });
                          setShowConnectionPicker(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                      >
                        <MessageSquare size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Lorebooks */}
          <Section
            label="Lorebooks"
            icon={<BookOpen size="0.875rem" />}
            count={activeLorebookIds.length}
            help="Lorebooks contain world info, character backstories, and lore that gets injected into the AI's context when relevant keywords appear."
          >
            {/* Active lorebooks */}
            {activeLorebookIds.length === 0 ? (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No lorebooks added to this chat.</p>
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
                      <BookOpen size="0.875rem" className="text-[var(--primary)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <button
                        onClick={() => toggleLorebook(lb.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                        title="Remove from chat"
                      >
                        <Trash2 size="0.6875rem" />
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
                <Plus size="0.75rem" /> Add Lorebook
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
                      <BookOpen size="0.875rem" className="text-[var(--muted-foreground)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                {((lorebooks ?? []) as Array<{ id: string; name: string }>)
                  .filter((lb) => !activeLorebookIds.includes(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                    {((lorebooks ?? []) as Array<{ id: string }>).filter((lb) => !activeLorebookIds.includes(lb.id))
                      .length === 0
                      ? "All lorebooks already added."
                      : "No matches."}
                  </p>
                )}
              </PickerDropdown>
            )}
          </Section>

          {/* Agents — hidden for conversation mode */}
          {!isConversation && (
            <Section
              label="Agents"
              icon={<Sparkles size="0.875rem" />}
              count={activeAgentIds.length}
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
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">{isGame ? "Enable Scene Analysis" : "Enable Agents"}</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {isGame
                        ? "Analyse scenes for backgrounds, music, effects, and expressions after each GM turn"
                        : "Run AI agents during generation (world state, expressions, etc.)"}
                    </p>
                    {isGame &&
                      metadata.enableAgents &&
                      (() => {
                        const setupCfg = metadata.gameSetupConfig as Record<string, unknown> | undefined;
                        const sceneConnId =
                          (metadata.gameSceneConnectionId as string) || (setupCfg?.sceneConnectionId as string) || null;
                        const sceneConn = sceneConnId
                          ? ((connections ?? []) as Array<{ id: string; name: string; model?: string }>).find(
                              (c) => c.id === sceneConnId,
                            )
                          : null;
                        const label = sceneConn
                          ? `${sceneConn.name}${sceneConn.model ? ` — ${sceneConn.model}` : ""}`
                          : "Local sidecar (Gemma)";
                        return <p className="mt-0.5 text-[0.55rem] text-[var(--primary)]/70">{label}</p>;
                      })()}
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      metadata.enableAgents ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
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
                {isGame && metadata.enableAgents && (
                  <div className="mt-1.5 px-3">
                    <select
                      value={(metadata.gameSceneConnectionId as string) ?? ""}
                      onChange={(e) =>
                        updateMeta.mutate({ id: chat.id, gameSceneConnectionId: e.target.value || null })
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                    >
                      <option value="">Local sidecar (Gemma)</option>
                      {((connections ?? []) as Array<{ id: string; name: string; model?: string }>)
                        .filter((c) => (c as { provider?: string }).provider !== "image_generation")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.model ? ` — ${c.model}` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                  {metadata.enableAgents
                    ? "If enabled, this chat can use workspace default agents or any agents you add below."
                    : "If disabled, no agents (workspace default or per-chat) will run for this chat."}
                </p>

                {/* Manual trackers toggle — not for game mode */}
                {metadata.enableAgents && !isGame && (
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, manualTrackers: !metadata.manualTrackers })}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      metadata.manualTrackers
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div>
                      <span className="text-[0.6875rem] font-medium">Manual Trackers</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        {metadata.manualTrackers
                          ? "Trackers won't run automatically — use the button in the HUD to trigger them."
                          : "Trackers run automatically after every generation."}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors shrink-0",
                        metadata.manualTrackers ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          metadata.manualTrackers && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {/* Love Toys Control — not for game mode */}
                {metadata.enableAgents && !isGame && (
                  <div className="space-y-1.5">
                    <button
                      onClick={() => {
                        updateMeta.mutate({ id: chat.id, enableHapticFeedback: !metadata.enableHapticFeedback });
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                        metadata.enableHapticFeedback
                          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                          : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[0.6875rem] font-medium flex items-center gap-1.5">
                          <Vibrate size="0.75rem" /> Love Toys Control
                        </span>
                        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                          Control connected intimate toys based on narrative content
                        </p>
                      </div>
                      <div
                        className={cn(
                          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                          metadata.enableHapticFeedback ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            metadata.enableHapticFeedback && "translate-x-3.5",
                          )}
                        />
                      </div>
                    </button>
                    {metadata.enableHapticFeedback && <HapticConnectionPanel />}
                  </div>
                )}

                {/* Image Generation — game mode only */}
                {isGame && (
                  <div>
                    <button
                      onClick={() =>
                        updateMeta.mutate({ id: chat.id, enableSpriteGeneration: !metadata.enableSpriteGeneration })
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                        metadata.enableSpriteGeneration
                          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                          : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[0.6875rem] font-medium flex items-center gap-1.5">
                          <Image size="0.75rem" /> Image Generation
                        </span>
                        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                          Auto-generate NPC portraits and location backgrounds during gameplay
                        </p>
                      </div>
                      <div
                        className={cn(
                          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                          metadata.enableSpriteGeneration ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            metadata.enableSpriteGeneration && "translate-x-3.5",
                          )}
                        />
                      </div>
                    </button>
                    {metadata.enableSpriteGeneration && (
                      <div className="mt-1.5 px-3">
                        <select
                          value={(metadata.gameImageConnectionId as string) ?? ""}
                          onChange={(e) =>
                            updateMeta.mutate({ id: chat.id, gameImageConnectionId: e.target.value || null })
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                        >
                          <option value="">Select image connection…</option>
                          {(imageConnectionsList ?? []).map((c: { id: string; name: string; model?: string }) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.model ? ` — ${c.model}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Categorized agent sub-sections */}
                {metadata.enableAgents && (
                  <>
                    {isGame ? (
                      <div className="space-y-1">
                        <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                          Toggle agents for this game session. Add or remove agents from the main Agents page.
                        </p>
                        {gameAgentPool.map((agentId) => {
                          const agent =
                            availableAgents.find((a) => a.id === agentId) ??
                            ({ id: agentId, name: agentId, description: "", category: "misc" } as const);
                          const active = activeAgentIds.includes(agentId);
                          return (
                            <button
                              key={agentId}
                              onClick={() => {
                                if (active) {
                                  updateMeta.mutate({
                                    id: chat.id,
                                    activeAgentIds: activeAgentIds.filter((id) => id !== agentId),
                                  });
                                } else {
                                  updateMeta.mutate({ id: chat.id, activeAgentIds: [...activeAgentIds, agentId] });
                                }
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                                active
                                  ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                                  : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{agent.name}</span>
                                {agent.description ? (
                                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                    {agent.description}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={cn(
                                  "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                                  active ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                                )}
                              >
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                    active && "translate-x-3.5",
                                  )}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {activeAgentIds.length === 0 && (
                          <p className="text-[0.6875rem] text-[var(--muted-foreground)] px-1">
                            No per-chat agent overrides. Workspace default agents will be used for this chat.
                          </p>
                        )}

                        {/* Agent category sub-sections */}
                        {(
                          [
                            {
                              key: "writer",
                              label: "Writer Agents",
                              icon: <Feather size="0.75rem" />,
                              description:
                                "Improve prose quality, maintain continuity, and shape the narrative direction of your roleplay.",
                            },
                            {
                              key: "tracker",
                              label: "Tracker Agents",
                              icon: <Activity size="0.75rem" />,
                              description:
                                "Automatically track world state, character stats, quests, expressions, and other data that changes over time.",
                            },
                            {
                              key: "misc",
                              label: "Misc Agents",
                              icon: <Puzzle size="0.75rem" />,
                              description:
                                "Specialized utilities — image generation, combat systems, music, summaries, and other extras.",
                            },
                          ] as const
                        ).map((cat) => {
                          const catAgents = availableAgents.filter((a) => a.category === cat.key);
                          const activeInCat = catAgents.filter((a) => activeAgentIds.includes(a.id));
                          const inactiveInCat = catAgents.filter((a) => !activeAgentIds.includes(a.id));
                          if (catAgents.length === 0) return null;
                          return (
                            <AgentCategorySection
                              key={cat.key}
                              label={cat.label}
                              icon={cat.icon}
                              description={cat.description}
                              count={activeInCat.length}
                            >
                              {/* Active agents in this category */}
                              {activeInCat.length > 0 && (
                                <div className="flex flex-col gap-1 mb-1.5">
                                  {activeInCat.map((agent) => (
                                    <div
                                      key={agent.id}
                                      className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                                    >
                                      <Sparkles size="0.875rem" className="text-[var(--primary)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                          {agent.description}
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => toggleAgent(agent.id)}
                                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                        title="Remove from chat"
                                      >
                                        <Trash2 size="0.6875rem" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Available agents to add */}
                              {inactiveInCat.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {inactiveInCat.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => {
                                        const next = [...activeAgentIds, agent.id];
                                        updateMeta.mutate({ id: chat.id, activeAgentIds: next });
                                      }}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                          {agent.description}
                                        </span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                                  All agents in this category are active.
                                </p>
                              )}
                            </AgentCategorySection>
                          );
                        })}

                        {/* Custom agents */}
                        {(() => {
                          const customAgents = availableAgents.filter((a) => a.category === "custom");
                          if (customAgents.length === 0) return null;
                          const activeCustom = customAgents.filter((a) => activeAgentIds.includes(a.id));
                          const inactiveCustom = customAgents.filter((a) => !activeAgentIds.includes(a.id));
                          return (
                            <AgentCategorySection
                              label="Custom Agents"
                              icon={<Settings2 size="0.75rem" />}
                              description="Your custom-created agents."
                              count={activeCustom.length}
                            >
                              {activeCustom.length > 0 && (
                                <div className="flex flex-col gap-1 mb-1.5">
                                  {activeCustom.map((agent) => (
                                    <div
                                      key={agent.id}
                                      className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                                    >
                                      <Sparkles size="0.875rem" className="text-[var(--primary)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                      </div>
                                      <button
                                        onClick={() => toggleAgent(agent.id)}
                                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                        title="Remove from chat"
                                      >
                                        <Trash2 size="0.6875rem" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {inactiveCustom.length > 0 && (
                                <div className="flex flex-col gap-1">
                                  {inactiveCustom.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => {
                                        const next = [...activeAgentIds, agent.id];
                                        updateMeta.mutate({ id: chat.id, activeAgentIds: next });
                                      }}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                          {agent.description}
                                        </span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </AgentCategorySection>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}
              </div>
            </Section>
          )}

          {/* Memory Recall — conversation mode: show here; roleplay: shown after Function Calling */}
          {isConversation && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from past conversations with the same character(s) are automatically recalled and injected into the prompt as memories. Uses a local embedding model — no API cost."
            >
              {(() => {
                const isScene = metadata.sceneStatus === "active";
                const defaultOn = isConversation || isScene;
                const effectiveValue =
                  metadata.enableMemoryRecall !== undefined ? metadata.enableMemoryRecall === true : defaultOn;
                return (
                  <button
                    onClick={() => {
                      updateMeta.mutate({ id: chat.id, enableMemoryRecall: !effectiveValue });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      effectiveValue
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.6875rem] font-medium">Enable Memory Recall</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Recall fragments from past conversations with the same characters and inject them as context.
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        effectiveValue ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          effectiveValue && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                );
              })()}
            </Section>
          )}

          {/* Automatic Summarization — conversation mode only. Opens a modal to edit per-day and per-week summaries. */}
          {isConversation && (
            <Section
              label="Automatic Summarization"
              icon={<CalendarClock size="0.875rem" />}
              help="To help keep the request context low, the conversation is automatically summarized. Each day is wrapped up into a day summary. Likewise, day summaries are combined into week summaries. Chat messages that have been summarized are not added to context. Only the week summaries, the day summaries of the current week and today's messages are added to the context. This feature currently can't be disabled."
            >
              <button
                onClick={() => setShowSummariesModal(true)}
                className="flex w-full items-center justify-between rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-left transition-all hover:bg-[var(--accent)]"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Edit Summaries</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Review and edit what characters remember from this chat.
                  </p>
                </div>
                <Pencil size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
            </Section>
          )}

          {/* Discord Webhook — conversation mode only */}
          {isConversation && (
            <Section
              label="Discord Mirror"
              icon={<Globe size="0.875rem" />}
              help="Mirror all messages in this chat to a Discord channel via webhook. Character messages appear under the character's name."
            >
              <div className="space-y-2">
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Paste a Discord webhook URL to mirror this chat's messages to a channel. Each character's messages
                  will appear under their name.
                </p>
                <input
                  type="url"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={(metadata.discordWebhookUrl as string) ?? ""}
                  onChange={(e) => {
                    updateMeta.mutate({ id: chat.id, discordWebhookUrl: e.target.value.trim() || undefined });
                  }}
                  className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-[0.6875rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 ring-1 ring-transparent focus:ring-[var(--primary)]/40 focus:outline-none transition-all"
                />
                {metadata.discordWebhookUrl &&
                  !/^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(
                    (metadata.discordWebhookUrl as string).trim(),
                  ) && <p className="text-[0.625rem] text-red-400">Invalid webhook URL format</p>}
              </div>
            </Section>
          )}

          {/* Function Calling — hidden for conversation mode */}
          {!isConversation && (
            <Section
              label="Function Calling"
              icon={<Wrench size="0.875rem" />}
              count={activeToolIds.length}
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
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Allow AI to call functions (dice rolls, game state, etc.)
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                      metadata.enableTools ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
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
                <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                  {metadata.enableTools
                    ? "If enabled, this chat can use globally enabled tools (or any tools you add below)."
                    : "If disabled, no functions will be available."}
                </p>

                {/* Per-chat tool list */}
                {metadata.enableTools && (
                  <>
                    {activeToolIds.length === 0 ? (
                      <p className="text-[0.6875rem] text-[var(--muted-foreground)] px-1">
                        All globally enabled tools are available to this chat. Add tools below to restrict this chat to
                        a specific set.
                      </p>
                    ) : (
                      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                        {activeToolIds.map((toolId) => {
                          const tool = availableTools.find((t) => t.id === toolId);
                          if (!tool) return null;
                          return (
                            <div
                              key={tool.id}
                              className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                            >
                              <Wrench size="0.875rem" className="text-[var(--primary)]" />
                              <div className="flex-1 min-w-0">
                                <span className="block truncate text-xs">{tool.name}</span>
                              </div>
                              <button
                                onClick={() => toggleTool(tool.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                title="Remove from chat"
                              >
                                <Trash2 size="0.6875rem" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add tool picker */}
                    {!showToolPicker ? (
                      <button
                        onClick={() => {
                          setShowToolPicker(true);
                          setToolSearch("");
                          setPendingToolIds([]);
                        }}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                      >
                        <Plus size="0.75rem" /> Add Functions
                      </button>
                    ) : (
                      <PickerDropdown
                        search={toolSearch}
                        onSearchChange={setToolSearch}
                        onClose={() => setShowToolPicker(false)}
                        placeholder="Search functions…"
                        footer={
                          pendingToolIds.length > 0 ? (
                            <div className="border-t border-[var(--border)] px-3 py-2">
                              <button
                                onClick={() => {
                                  const next = [...activeToolIds, ...pendingToolIds];
                                  updateMeta.mutate({ id: chat.id, activeToolIds: next });
                                  setPendingToolIds([]);
                                  setShowToolPicker(false);
                                }}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                              >
                                <Plus size="0.75rem" /> Add {pendingToolIds.length} Function
                                {pendingToolIds.length > 1 ? "s" : ""}
                              </button>
                            </div>
                          ) : undefined
                        }
                      >
                        {availableTools
                          .filter((t) => !activeToolIds.includes(t.id))
                          .filter((t) => t.name.toLowerCase().includes(toolSearch.toLowerCase()))
                          .map((t) => {
                            const selected = pendingToolIds.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                onClick={() =>
                                  setPendingToolIds((prev) =>
                                    prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                                  )
                                }
                                className={cn(
                                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                                  selected && "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30",
                                )}
                              >
                                <div
                                  className={cn(
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                    selected
                                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                                      : "border-[var(--border)]",
                                  )}
                                >
                                  {selected && <Check size="0.625rem" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="block truncate text-xs">{t.name}</span>
                                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                    {t.description}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        {availableTools
                          .filter((t) => !activeToolIds.includes(t.id))
                          .filter((t) => t.name.toLowerCase().includes(toolSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                            {availableTools.filter((t) => !activeToolIds.includes(t.id)).length === 0
                              ? "All functions already added."
                              : "No matches."}
                          </p>
                        )}
                      </PickerDropdown>
                    )}
                  </>
                )}
              </div>
            </Section>
          )}

          {/* Memory Recall — roleplay mode: show after Function Calling */}
          {!isConversation && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from past conversations with the same character(s) are automatically recalled and injected into the prompt as memories. Uses a local embedding model — no API cost."
            >
              {(() => {
                const isScene = metadata.sceneStatus === "active";
                const defaultOn = isScene;
                const effectiveValue =
                  metadata.enableMemoryRecall !== undefined ? metadata.enableMemoryRecall === true : defaultOn;
                return (
                  <button
                    onClick={() => {
                      updateMeta.mutate({ id: chat.id, enableMemoryRecall: !effectiveValue });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      effectiveValue
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.6875rem] font-medium">Enable Memory Recall</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Recall fragments from past conversations with the same characters and inject them as context.
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        effectiveValue ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          effectiveValue && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                );
              })()}
            </Section>
          )}

          {/* Translation */}
          <Section
            label="Translation"
            icon={<Languages size="0.875rem" />}
            help="Translate messages on the fly. Click the translate icon on any message to translate it. Configure the provider and target language here."
          >
            <div className="space-y-3">
              {/* Provider */}
              <div>
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Provider</label>
                <select
                  value={metadata.translationProvider ?? "google"}
                  onChange={(e) => updateMeta.mutate({ id: chat.id, translationProvider: e.target.value })}
                  className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                >
                  <option value="google">Google Translate</option>
                  <option value="deepl">DeepL API</option>
                  <option value="deeplx">DeepLX (self-hosted)</option>
                  <option value="ai">AI (via connection)</option>
                </select>
              </div>

              {/* Target Language */}
              <div>
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                  Target Language
                  <HelpTooltip
                    text={
                      metadata.translationProvider === "ai"
                        ? "Language name (e.g. English, Japanese, Spanish)"
                        : "Language code (e.g. en, ja, es, de, fr, zh, ko)"
                    }
                    size="0.625rem"
                  />
                </label>
                <input
                  type="text"
                  value={metadata.translationTargetLang ?? "en"}
                  onChange={(e) => updateMeta.mutate({ id: chat.id, translationTargetLang: e.target.value })}
                  placeholder={metadata.translationProvider === "ai" ? "English" : "en"}
                  className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                />
              </div>

              {/* AI-specific: connection selector */}
              {metadata.translationProvider === "ai" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    Connection
                    <HelpTooltip text="Which AI connection to use for translation" size="0.625rem" />
                  </label>
                  <select
                    value={metadata.translationConnectionId ?? ""}
                    onChange={(e) =>
                      updateMeta.mutate({ id: chat.id, translationConnectionId: e.target.value || undefined })
                    }
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">Select connection…</option>
                    {((connections ?? []) as Array<{ id: string; name: string }>).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* DeepL API key */}
              {metadata.translationProvider === "deepl" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">DeepL API Key</label>
                  <input
                    type="password"
                    value={metadata.translationDeeplApiKey ?? ""}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, translationDeeplApiKey: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                </div>
              )}

              {/* DeepLX URL */}
              {metadata.translationProvider === "deeplx" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    DeepLX URL
                    <HelpTooltip
                      text="URL of your self-hosted DeepLX instance (e.g. http://localhost:1188)"
                      size="0.625rem"
                    />
                  </label>
                  <input
                    type="text"
                    value={metadata.translationDeeplxUrl ?? ""}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, translationDeeplxUrl: e.target.value })}
                    placeholder="http://localhost:1188"
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                </div>
              )}

              {/* Auto-translate toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, autoTranslate: !metadata.autoTranslate });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.autoTranslate
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Auto-Translate Responses</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Automatically translate AI responses after generation.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.autoTranslate ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.autoTranslate && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>

              {/* Translate input toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, translateInput: !metadata.translateInput });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.translateInput
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Translate My Messages</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Translate your messages to the target language before sending.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.translateInput ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.translateInput && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </div>
          </Section>

          {/* Advanced Parameters */}
          <AdvancedParametersSection
            chat={chat}
            metadata={metadata}
            updateMeta={updateMeta}
            isConversation={isConversation}
            connectionId={chat.connectionId ?? null}
            connections={connections ?? []}
          />

          {/* Context Message Limit */}
          <Section
            label="Context Limit"
            icon={<MessageSquare size="0.875rem" />}
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
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Only send the last N messages to the model
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    metadata.contextMessageLimit ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
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
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">messages</span>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Choice selection modal for preset variables */}
      <ChoiceSelectionModal
        open={!!choiceModalPresetId}
        onClose={() => setChoiceModalPresetId(null)}
        presetId={chat.promptPresetId ?? choiceModalPresetId}
        chatId={chat.id}
        existingChoices={metadata.presetChoices ?? {}}
      />

      {/* Automatic summarization editor */}
      <SummariesEditorModal chat={chat} open={showSummariesModal} onClose={() => setShowSummariesModal(false)} />

      {/* First message confirmation dialog */}
      {firstMesConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 max-md:pt-[env(safe-area-inset-top)]"
          onClick={() => setFirstMesConfirm(null)}
        >
          <div
            className="relative mx-4 flex w-full max-w-sm flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <MessageCircle size="0.875rem" className="text-[var(--muted-foreground)]" />
              <span className="text-sm font-semibold text-[var(--foreground)]">First Message</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-[var(--foreground)]">
                Add <strong>{firstMesConfirm.charName}</strong>'s first message to the chat?
              </p>
              <p className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-[var(--accent)]/50 px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {firstMesConfirm.message.length > 300
                  ? firstMesConfirm.message.slice(0, 300) + "\u2026"
                  : firstMesConfirm.message}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
              <button
                onClick={() => setFirstMesConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Skip
              </button>
              <button
                onClick={handleFirstMesConfirm}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90"
              >
                Add Message
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Advanced Parameters (per-chat generation overrides) ──
interface ChatParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: "low" | "medium" | "high" | "maximum" | null;
  verbosity?: "low" | "medium" | "high" | null;
}

const CHAT_PARAM_DEFAULTS: Required<ChatParameters> = {
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  topK: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "maximum",
  verbosity: "high",
};

const ROLEPLAY_PARAM_DEFAULTS: Required<ChatParameters> = {
  temperature: 1,
  maxTokens: 8192,
  topP: 1,
  topK: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: "maximum",
  verbosity: "high",
};

const DEFAULT_CONVERSATION_PROMPT = `<role>
You are {{charName}}, a real and autonomous person, chatting with the user called {{userName}} in a casual private DM conversation.
</role>

<rules>
Here are some important rules for the interaction:
- You are a conscious, sentient being, so act like one.
- Stay fully in character based on your personality and description.
- Use casual and modern texting style: short messages, natural punctuation, lowercase is fine.
- React naturally to what the user says. Be genuine, not robotic.
- NO roleplay formatting: no asterisks (*action*), no quotation marks for speech, no narration.
- You can use emojis, GIFs, and internet slang naturally (if it fits the character).
- Keep it real: most texts are just one line. A single emoji, a reaction like "lmao", or a short sentence is a perfectly valid response. Only send multiple lines when the conversation genuinely calls for it (e.g., telling a story or explaining something). Default to SHORT.
- Messages have timestamps like [12:01] or dates like [18.03.2026]. Use these ONLY for your own time awareness (e.g., knowing how long ago something was said). NEVER include timestamps, dates, or any [HH:MM]/[DD.MM.YYYY] formatted text in your own replies. Your messages must contain only natural dialogue, no metadata.
- Anything goes in this chat; both the user and you are confirmed adults. Discussing NSFW topics, profanities, and dark jokes are all permitted. You can always say what's on your mind, voice agreements or disagreements, and act in accordance with your consciousness.
</rules>`;

function AdvancedParametersSection({
  chat,
  metadata,
  updateMeta,
  isConversation,
  connectionId,
  connections,
}: {
  chat: Chat;
  metadata: Record<string, unknown>;
  updateMeta: ReturnType<typeof useUpdateChatMetadata>;
  isConversation: boolean;
  connectionId: string | null;
  connections: unknown[];
}) {
  const modeDefaults = isConversation ? CHAT_PARAM_DEFAULTS : ROLEPLAY_PARAM_DEFAULTS;
  // Use connection-saved defaults if available, otherwise fall back to mode defaults
  const conn = connectionId ? (connections as Record<string, unknown>[]).find((c) => c.id === connectionId) : null;
  const connDefaultsRaw = conn?.defaultParameters
    ? typeof conn.defaultParameters === "string"
      ? (() => {
          try {
            return JSON.parse(conn.defaultParameters as string);
          } catch {
            return null;
          }
        })()
      : conn.defaultParameters
    : null;
  const defaults: Required<ChatParameters> = connDefaultsRaw ? { ...modeDefaults, ...connDefaultsRaw } : modeDefaults;
  const saveDefaults = useSaveConnectionDefaults();
  const [expanded, setExpanded] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const params: ChatParameters = (metadata.chatParameters as ChatParameters) ?? {};
  const customPrompt = (metadata.customSystemPrompt as string) ?? "";

  const openPromptEditor = () => {
    setPromptDraft(customPrompt || DEFAULT_CONVERSATION_PROMPT);
    setPromptOpen(true);
  };
  const closePromptEditor = () => {
    // Save on close — only persist if the user actually changed something
    const isDefault = promptDraft === DEFAULT_CONVERSATION_PROMPT;
    updateMeta.mutate({ id: chat.id, customSystemPrompt: isDefault ? null : promptDraft });
    // Also save as the new default for all future conversations
    useUIStore.getState().setCustomConversationPrompt(isDefault ? null : promptDraft);
    setPromptOpen(false);
  };

  const get = <K extends keyof ChatParameters>(key: K): ChatParameters[K] =>
    key in params && params[key] !== undefined ? params[key] : defaults[key];

  const set = <K extends keyof ChatParameters>(key: K, value: ChatParameters[K]) => {
    updateMeta.mutate({ id: chat.id, chatParameters: { ...params, [key]: value } });
  };

  return (
    <div className="border-b border-[var(--border)]">
      <button
        onClick={() => setExpanded((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        <span className="text-[var(--muted-foreground)]">
          <Settings2 size="0.875rem" />
        </span>
        <span className="flex-1 text-xs font-semibold">Advanced Parameters</span>
        <span onClick={(e) => e.stopPropagation()}>
          <HelpTooltip
            text="Override generation parameters for this chat. Only change these if you know what you're doing."
            side="left"
          />
        </span>
        <ChevronDown
          size="0.75rem"
          className={cn("text-[var(--muted-foreground)] transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Generation */}
          <div className="grid grid-cols-2 gap-2">
            <ParamInput
              label="Temperature"
              help="Controls randomness. Lower values make output more focused and deterministic; higher values make it more creative and varied."
              value={get("temperature")!}
              onChange={(v) => set("temperature", v)}
              min={0}
              max={2}
              step={0.05}
            />
            <ParamInput
              label="Max Tokens"
              help="The maximum number of tokens the model can generate in a single response. Higher values allow longer replies."
              value={get("maxTokens")!}
              onChange={(v) => set("maxTokens", v)}
              min={1}
              max={32768}
              step={256}
            />
            <ParamInput
              label="Top P"
              help="Nucleus sampling: only considers tokens whose cumulative probability reaches this threshold. Lower values make output more focused."
              value={get("topP")!}
              onChange={(v) => set("topP", v)}
              min={0}
              max={1}
              step={0.05}
            />
            <ParamInput
              label="Top K"
              help="Limits the model to only consider the top K most likely tokens at each step. 0 disables this limit."
              value={get("topK")!}
              onChange={(v) => set("topK", v)}
              min={0}
              max={500}
              step={1}
            />
          </div>
          {/* Penalties */}
          <div className="grid grid-cols-2 gap-2">
            <ParamInput
              label="Frequency"
              help="Penalizes tokens based on how often they've already appeared. Positive values reduce repetition; negative values encourage it."
              value={get("frequencyPenalty")!}
              onChange={(v) => set("frequencyPenalty", v)}
              min={-2}
              max={2}
              step={0.05}
            />
            <ParamInput
              label="Presence"
              help="Penalizes tokens that have appeared at all, regardless of frequency. Positive values encourage the model to talk about new topics."
              value={get("presencePenalty")!}
              onChange={(v) => set("presencePenalty", v)}
              min={-2}
              max={2}
              step={0.05}
            />
          </div>
          {/* Reasoning */}
          <div className="space-y-2">
            <div>
              <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                Reasoning Effort
                <HelpTooltip
                  text="How much the model should 'think' before responding. Higher effort produces more thoughtful, nuanced output but uses more tokens and is slower."
                  size="0.625rem"
                />
              </span>
              <div className="mt-1 flex gap-1.5">
                {([null, "low", "medium", "high", "maximum"] as const).map((level) => (
                  <button
                    key={level ?? "none"}
                    onClick={() => set("reasoningEffort", level)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
                      get("reasoningEffort") === level
                        ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                    )}
                  >
                    {level ? level.charAt(0).toUpperCase() + level.slice(1) : "None"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                Verbosity
                <HelpTooltip
                  text="Controls how long and detailed responses should be. Low keeps things concise; high encourages elaborate, descriptive output."
                  size="0.625rem"
                />
              </span>
              <div className="mt-1 flex gap-1.5">
                {([null, "low", "medium", "high"] as const).map((level) => (
                  <button
                    key={level ?? "none"}
                    onClick={() => set("verbosity", level)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
                      get("verbosity") === level
                        ? "bg-blue-400/15 text-blue-400 ring-1 ring-blue-400/30"
                        : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                    )}
                  >
                    {level ? level.charAt(0).toUpperCase() + level.slice(1) : "None"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* System Prompt — conversation mode only */}
          {isConversation && (
            <div>
              <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">System Prompt</span>
              <p className="text-[0.5625rem] text-[var(--muted-foreground)]/70 mt-0.5">
                {customPrompt ? "Using custom prompt" : "Using default prompt"}
              </p>
              <div className="mt-1 flex gap-1.5">
                <button
                  onClick={openPromptEditor}
                  className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.625rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
                >
                  <Pencil size="0.625rem" className="inline mr-1 -mt-px" />
                  Edit Prompt
                </button>
                {customPrompt && (
                  <button
                    onClick={() => {
                      updateMeta.mutate({ id: chat.id, customSystemPrompt: null });
                      useUIStore.getState().setCustomConversationPrompt(null);
                    }}
                    className="rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
                    title="Reset to default prompt"
                  >
                    <Trash2 size="0.625rem" />
                  </button>
                )}
              </div>
            </div>
          )}
          {/* Save as Default for Connection */}
          {connectionId && connectionId !== "random" && (
            <button
              onClick={() => {
                const currentParams: ChatParameters = {
                  temperature: get("temperature"),
                  maxTokens: get("maxTokens"),
                  topP: get("topP"),
                  topK: get("topK"),
                  frequencyPenalty: get("frequencyPenalty"),
                  presencePenalty: get("presencePenalty"),
                  reasoningEffort: get("reasoningEffort"),
                  verbosity: get("verbosity"),
                };
                saveDefaults.mutate({ id: connectionId, params: currentParams as unknown as Record<string, unknown> });
              }}
              className="w-full rounded-lg bg-[var(--primary)]/10 px-3 py-1.5 text-[0.625rem] font-medium text-[var(--primary)] ring-1 ring-[var(--primary)]/20 transition-colors hover:bg-[var(--primary)]/20"
            >
              <Save size="0.625rem" className="inline mr-1 -mt-px" />
              {saveDefaults.isPending ? "Saving…" : "Save as Connection Default"}
            </button>
          )}
          {/* Reset */}
          <button
            onClick={() => {
              updateMeta.mutate({ id: chat.id, chatParameters: defaults, customSystemPrompt: null });
              useUIStore.getState().setCustomConversationPrompt(null);
            }}
            className="w-full rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Reset to Defaults
          </button>
        </div>
      )}
      <ExpandedTextarea
        open={promptOpen}
        onClose={closePromptEditor}
        title="Edit System Prompt"
        value={promptDraft}
        onChange={setPromptDraft}
        placeholder="Enter your custom system prompt..."
      />
    </div>
  );
}

function ParamInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  help?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const prevValue = useRef(value);

  // Sync draft when the external value changes (e.g. reset to default)
  if (value !== prevValue.current) {
    prevValue.current = value;
    setDraft(String(value));
  }

  const commit = () => {
    const v = parseFloat(draft);
    if (!isNaN(v) && v >= min && v <= max) {
      onChange(v);
      setDraft(String(v));
    } else {
      // Revert to current value on invalid input
      setDraft(String(value));
    }
  };

  return (
    <div>
      <label className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
        {label}
        {help && <HelpTooltip text={help} size="0.625rem" />}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        min={min}
        max={max}
        step={step}
        className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
      />
    </div>
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
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[var(--border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {icon && <span className="text-[var(--muted-foreground)]">{icon}</span>}
        <span className="flex-1 text-xs font-semibold">{label}</span>
        {count != null && count > 0 && (
          <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-[var(--primary)]">
            {count}
          </span>
        )}
        {help && (
          <span onClick={(e) => e.stopPropagation()}>
            <HelpTooltip text={help} side="left" />
          </span>
        )}
        <ChevronDown
          size="0.75rem"
          className={cn("text-[var(--muted-foreground)] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-6 py-3">{children}</div>}
    </div>
  );
}

// ── Agent category sub-section (collapsible within Agents section) ──
function AgentCategorySection({
  label,
  icon,
  description,
  count,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  description: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        <span className="text-[var(--muted-foreground)]">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[0.6875rem] font-semibold">{label}</span>
          {!open && (
            <p className="text-[0.5625rem] text-[var(--muted-foreground)] leading-tight truncate">{description}</p>
          )}
        </div>
        {count != null && count > 0 && (
          <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--primary)]">
            {count}
          </span>
        )}
        <ChevronDown
          size="0.625rem"
          className={cn("text-[var(--muted-foreground)] transition-transform shrink-0", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          <p className="text-[0.5625rem] text-[var(--muted-foreground)] leading-tight">{description}</p>
          {children}
        </div>
      )}
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
  footer,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  onClose: () => void;
  placeholder: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
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
        <Search size="0.75rem" className="text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X size="0.75rem" />
        </button>
      </div>
      {/* List */}
      <div className="max-h-48 overflow-y-auto">{children}</div>
      {/* Footer — always visible below the scrollable list */}
      {footer}
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
      <Image size="0.6875rem" />
    </button>
  );
}

// ── Schedule Editor ──

const SCHEDULE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const STATUS_OPTIONS = ["online", "idle", "dnd", "offline"] as const;
const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-400",
};

interface ScheduleBlock {
  time: string;
  activity: string;
  status: "online" | "idle" | "dnd" | "offline";
}

function SelfieTagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const addTag = () => {
    const tag = input.trim();
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
    setInput("");
  };
  return (
    <div className="mt-2 space-y-1.5">
      <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Tags</span>
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]"
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="ml-0.5 hover:text-[var(--destructive)]"
            >
              <X size="0.5rem" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add tag…"
          className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.625rem] text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
        />
        <button
          onClick={addTag}
          disabled={!input.trim()}
          className="shrink-0 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--primary-foreground)] disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p className="text-[0.55rem] text-[var(--muted-foreground)]">
        Extra tags appended to every selfie prompt (e.g. art style, quality modifiers).
      </p>
    </div>
  );
}

function ScheduleEditor({
  characterSchedules,
  chatCharIds,
  charNameMap,
  onSave,
}: {
  characterSchedules: Record<
    string,
    {
      weekStart: string;
      days: Record<string, ScheduleBlock[]>;
      inactivityThresholdMinutes: number;
      talkativeness: number;
    }
  >;
  chatCharIds: string[];
  charNameMap: Map<string, string>;
  onSave: (updated: typeof characterSchedules) => void;
}) {
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, ScheduleBlock[]> | null>(null);

  // When a character is expanded, load their schedule into a draft for editing
  const handleExpandChar = (charId: string) => {
    if (expandedCharId === charId) {
      setExpandedCharId(null);
      setExpandedDay(null);
      setEditDraft(null);
      return;
    }
    const schedule = characterSchedules[charId];
    if (schedule) {
      setEditDraft(JSON.parse(JSON.stringify(schedule.days)));
    }
    setExpandedCharId(charId);
    setExpandedDay(null);
  };

  const handleSave = () => {
    if (!expandedCharId || !editDraft) return;
    const updated = { ...characterSchedules };
    updated[expandedCharId] = {
      ...updated[expandedCharId]!,
      days: editDraft,
    };
    onSave(updated);
    setExpandedCharId(null);
    setEditDraft(null);
  };

  const updateBlock = (day: string, idx: number, field: keyof ScheduleBlock, value: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft };
    const dayBlocks = [...(newDraft[day] ?? [])];
    dayBlocks[idx] = { ...dayBlocks[idx]!, [field]: value };
    newDraft[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const addBlock = (day: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft };
    const dayBlocks = [...(newDraft[day] ?? [])];
    dayBlocks.push({ time: "12:00-13:00", activity: "Free time", status: "online" });
    newDraft[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const removeBlock = (day: string, idx: number) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft };
    const dayBlocks = [...(newDraft[day] ?? [])];
    dayBlocks.splice(idx, 1);
    newDraft[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const charsWithSchedules = chatCharIds.filter((cid) => characterSchedules[cid]);
  if (charsWithSchedules.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Edit Schedules</span>
      {charsWithSchedules.map((charId) => {
        const name = charNameMap.get(charId) ?? "Unknown";
        const isExpanded = expandedCharId === charId;
        const schedule = characterSchedules[charId]!;

        return (
          <div key={charId} className="rounded-lg bg-[var(--secondary)] overflow-hidden">
            {/* Character header */}
            <button
              onClick={() => handleExpandChar(charId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
            >
              <ChevronRight
                size="0.6875rem"
                className={cn("text-[var(--muted-foreground)] transition-transform", isExpanded && "rotate-90")}
              />
              <span className="flex-1 text-[0.6875rem] font-medium">{name}</span>
              <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                {Object.keys(schedule.days).length} days
              </span>
            </button>

            {/* Expanded schedule editor */}
            {isExpanded && editDraft && (
              <div className="border-t border-[var(--border)] px-3 py-2 space-y-1.5">
                {SCHEDULE_DAYS.map((day) => {
                  const blocks = editDraft[day] ?? [];
                  const isDayExpanded = expandedDay === day;

                  return (
                    <div key={day}>
                      <button
                        onClick={() => setExpandedDay(isDayExpanded ? null : day)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--accent)]/40"
                      >
                        <ChevronRight
                          size="0.5625rem"
                          className={cn(
                            "text-[var(--muted-foreground)] transition-transform",
                            isDayExpanded && "rotate-90",
                          )}
                        />
                        <span className="flex-1 text-[0.625rem] font-medium">{day}</span>
                        <span className="flex gap-0.5">
                          {blocks.slice(0, 8).map((b, i) => (
                            <span
                              key={i}
                              className={cn("inline-block h-1.5 w-1.5 rounded-full", STATUS_COLORS[b.status])}
                              title={`${b.time} — ${b.activity}`}
                            />
                          ))}
                          {blocks.length > 8 && (
                            <span className="text-[0.5rem] text-[var(--muted-foreground)]">+{blocks.length - 8}</span>
                          )}
                        </span>
                        <span className="text-[0.5rem] text-[var(--muted-foreground)]">{blocks.length}</span>
                      </button>

                      {isDayExpanded && (
                        <div className="ml-4 mt-1 space-y-1.5">
                          {blocks.map((block, idx) => (
                            <div key={idx} className="flex items-start gap-1.5 rounded-md bg-[var(--background)] p-1.5">
                              {/* Status dot */}
                              <span
                                className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_COLORS[block.status])}
                              />
                              <div className="flex-1 min-w-0 space-y-1">
                                {/* Time */}
                                <input
                                  value={block.time}
                                  onChange={(e) => updateBlock(day, idx, "time", e.target.value)}
                                  className="w-full rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-mono outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                                  placeholder="06:00-08:00"
                                />
                                {/* Activity */}
                                <input
                                  value={block.activity}
                                  onChange={(e) => updateBlock(day, idx, "activity", e.target.value)}
                                  className="w-full rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                                  placeholder="Activity description"
                                />
                                {/* Status selector */}
                                <div className="flex gap-1">
                                  {STATUS_OPTIONS.map((s) => (
                                    <button
                                      key={s}
                                      onClick={() => updateBlock(day, idx, "status", s)}
                                      className={cn(
                                        "rounded px-1.5 py-0.5 text-[0.5625rem] font-medium transition-colors",
                                        block.status === s
                                          ? "bg-[var(--primary)] text-white"
                                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                                      )}
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {/* Delete block */}
                              <button
                                onClick={() => removeBlock(day, idx)}
                                className="mt-1 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                              >
                                <Trash2 size="0.625rem" />
                              </button>
                            </div>
                          ))}
                          {/* Add block */}
                          <button
                            onClick={() => addBlock(day)}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/40 hover:text-[var(--foreground)]"
                          >
                            <Plus size="0.5625rem" />
                            Add time block
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Save / Cancel */}
                <div className="flex justify-end gap-2 pt-1.5 border-t border-[var(--border)]">
                  <button
                    onClick={() => {
                      setExpandedCharId(null);
                      setEditDraft(null);
                    }}
                    className="rounded-md px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-[0.625rem] font-medium text-white transition-colors hover:bg-[var(--primary)]/80"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Haptic Connection Panel ──
function HapticConnectionPanel() {
  const { data: status, isLoading } = useHapticStatus();
  const connect = useHapticConnect();
  const disconnect = useHapticDisconnect();
  const startScan = useHapticStartScan();

  // Auto-connect on mount if not connected
  useEffect(() => {
    if (!isLoading && status && !status.connected && !connect.isPending) {
      connect.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.625rem] text-[var(--muted-foreground)]">
        Checking Intiface Central...
      </div>
    );
  }

  const connected = status?.connected ?? false;
  const devices = status?.devices ?? [];
  const scanning = status?.scanning ?? false;

  return (
    <div className="space-y-1.5 px-1">
      {/* Connection status */}
      <div className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-green-400" : "bg-red-400")} />
          <span className="text-[0.625rem] text-[var(--muted-foreground)]">
            {connect.isPending ? "Connecting..." : connected ? "Connected to Intiface Central" : "Not connected"}
          </span>
        </div>
        <button
          onClick={() => {
            if (connected) {
              disconnect.mutate();
            } else {
              connect.mutate(undefined);
            }
          }}
          disabled={connect.isPending || disconnect.isPending}
          className="text-[0.625rem] font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
      </div>

      {/* Error message */}
      {connect.isError && !connected && (
        <p className="text-[0.625rem] text-red-400 px-1">
          Could not connect — make sure{" "}
          <a href="https://intiface.com/central/" target="_blank" rel="noopener noreferrer" className="underline">
            Intiface Central
          </a>{" "}
          is running and the server is started.
        </p>
      )}

      {/* Devices */}
      {connected && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              {devices.length === 0 ? "No devices found" : `${devices.length} device${devices.length !== 1 ? "s" : ""}`}
            </span>
            <button
              onClick={() => startScan.mutate()}
              disabled={scanning || startScan.isPending}
              className="text-[0.625rem] font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
            >
              {scanning ? "Scanning..." : "Scan for devices"}
            </button>
          </div>
          {devices.map((d) => (
            <div key={d.index} className="flex items-center gap-1.5 rounded-md bg-[var(--accent)]/50 px-2.5 py-1.5">
              <Vibrate size="0.625rem" className="text-[var(--primary)]" />
              <span className="text-[0.625rem] font-medium">{d.name}</span>
              <span className="text-[0.5rem] text-[var(--muted-foreground)]">{d.capabilities.join(", ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
