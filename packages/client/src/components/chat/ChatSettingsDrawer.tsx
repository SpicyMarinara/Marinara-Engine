// ──────────────────────────────────────────────
// Chat: Settings Drawer — per-chat configuration
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  X,
  Users,
  User,
  BookOpen,
  Sliders,
  Plug,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Plus,
  Trash2,
  Wrench,
  Search,
  MessageSquare,
  Sparkles,
  Image,
  Pencil,
  Clock,
  AlertTriangle,
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
  Star,
  StickyNote,
  Drama,
  RotateCcw,
} from "lucide-react";
import { cn, getAvatarCropStyle, type AvatarCrop } from "../../lib/utils";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "../../lib/app-dialogs";
import { HelpTooltip } from "../ui/HelpTooltip";
import { ExpandedTextarea } from "../ui/ExpandedTextarea";
import { Modal } from "../ui/Modal";
import {
  CHAT_PARAMETER_DEFAULTS,
  GenerationParametersFields,
  getEditableGenerationParameters,
  type EditableGenerationParameters,
  ROLEPLAY_PARAMETER_DEFAULTS,
} from "../ui/GenerationParametersEditor";
import { ChoiceSelectionModal } from "../presets/ChoiceSelectionModal";
import { SummariesEditorModal } from "./SummariesEditorModal";
import { useCharacters, usePersonas, useCharacterGroups, type SpriteInfo } from "../../hooks/use-characters";
import { useLorebooks } from "../../hooks/use-lorebooks";
import { usePresetFull, usePresets } from "../../hooks/use-presets";
import { useConnections, useSaveConnectionDefaults } from "../../hooks/use-connections";
import { useGenerate } from "../../hooks/use-generate";
import {
  useUpdateChat,
  useUpdateChatMetadata,
  useCreateMessage,
  useChats,
  useConnectChat,
  useDisconnectChat,
  useChatMemories,
  useDeleteChatMemory,
  useClearChatMemories,
  useRefreshChatMemories,
  useChatNotes,
  useDeleteChatNote,
  useClearChatNotes,
  chatKeys,
} from "../../hooks/use-chats";
import { api } from "../../lib/api-client";
import {
  getAgentRunIntervalMeta,
  getCadenceInputValue,
  parseCadenceInputValue,
  stepCadenceValue,
} from "../../lib/agent-cadence";
import { getCharacterTitle, parseCharacterDisplayData } from "../../lib/character-display";
import { useUIStore } from "../../stores/ui.store";
import {
  useChatPresets,
  useSaveChatPresetSettings,
  useDuplicateChatPreset,
  useUpdateChatPreset,
  useDeleteChatPreset,
  useApplyChatPreset,
  useImportChatPreset,
  useSetActiveChatPreset,
} from "../../hooks/use-chat-presets";
import type {
  AgentPhase,
  ChatMode,
  ChatMemoryChunk,
  ChatPreset,
  ChatPresetSettings,
  ConversationNote,
} from "@marinara-engine/shared";
import { useAgentConfigs, useCreateAgent, useUpdateAgent, type AgentConfigRow } from "../../hooks/use-agents";
import { useAgentStore } from "../../stores/agent.store";
import {
  BUILT_IN_AGENTS,
  BUILT_IN_TOOLS,
  DEFAULT_AGENT_CONTEXT_SIZE,
  DEFAULT_AGENT_TOOLS,
  DEFAULT_IMPERSONATE_PROMPT,
  DEFAULT_AGENT_MAX_TOKENS,
  DEFAULT_AGENT_PROMPTS,
  LIMITS,
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  estimateAgentLoadCost,
  AGENT_COST_HIGH_CALLS,
  AGENT_COST_HIGH_TOKENS,
  getDefaultBuiltInAgentSettings,
} from "@marinara-engine/shared";
import type { Chat, CharacterGroup, Lorebook } from "@marinara-engine/shared";
import {
  isCustomToolSelectable,
  useCustomToolCapabilities,
  useCustomTools,
  type CustomToolRow,
} from "../../hooks/use-custom-tools";
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

const MODE_INTROS: Record<ChatMode, string> = {
  conversation:
    "Plain chat — no roleplay or game systems built in; autonomous messaging and other tools are optional below.",
  roleplay:
    "Plain roleplay surface — no built-in dice, combat, or GM pipeline; sprites, world-state tracking, and other helpers are available as optional agents below.",
  visual_novel:
    "Sprite- and background-driven roleplay — expressions, world state, and CYOA choices are available as optional agents below.",
  game: "Full Game Master with built-in dice, combat, encounters, world state, and session/map tracking — the Scene Analysis toggle below adds optional cinematic visuals (backgrounds, music, weather).",
};

type AvailableAgent = {
  id: string;
  name: string;
  description: string;
  category: string;
  phase: AgentPhase;
  builtIn: boolean;
};

type LorebookActiveReason = "Global" | "Character" | "Persona" | "Chat";

type ActiveLorebookView = Lorebook & {
  activeReasons: LorebookActiveReason[];
  isPinned: boolean;
};

type AgentAddPreview = {
  agent: AvailableAgent;
  config: AgentConfigRow | null;
  contextSize: number;
  maxTokens: number;
  runInterval: number | null;
};

function parseAgentSettings(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function normalizeAgentMaxTokens(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_MAX_TOKENS;
  return Math.max(MIN_AGENT_MAX_TOKENS, Math.min(MAX_AGENT_MAX_TOKENS, Math.trunc(value)));
}

function normalizeAgentMaxTokensInputValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_AGENT_MAX_TOKENS, Math.trunc(value)));
}

function normalizeSpriteDisplayValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function isEnabledFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function getChatActiveAgentIds(chat: Chat): string[] {
  const metadata = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
  const activeIds = metadata && typeof metadata === "object" ? (metadata as { activeAgentIds?: unknown }).activeAgentIds : [];
  return Array.isArray(activeIds) ? activeIds.filter((id): id is string => typeof id === "string") : [];
}

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
  const updateAgentConfig = useUpdateAgent();
  const createAgent = useCreateAgent();
  const createMessage = useCreateMessage(chat.id);
  const connectChat = useConnectChat();
  const disconnectChat = useDisconnectChat();
  const { retryAgents } = useGenerate();
  const agentProcessing = useAgentStore((s) => s.isProcessing);
  const scheduleGenerationPreferences = useUIStore((s) => s.scheduleGenerationPreferences);
  const setScheduleGenerationPreferences = useUIStore((s) => s.setScheduleGenerationPreferences);

  const { data: allCharacters } = useCharacters();
  const { data: characterGroups } = useCharacterGroups();
  const { data: lorebooks } = useLorebooks();
  const { data: presets } = usePresets();
  const chatMode = (chat as unknown as { mode?: string }).mode ?? "roleplay";
  const isConversation = chatMode === "conversation";
  const isGame = chatMode === "game";
  const isRoleplayMode = chatMode === "roleplay" || chatMode === "visual_novel";
  const { data: currentPromptPresetFull } = usePresetFull(isConversation ? null : (chat.promptPresetId ?? null));
  const { data: connections } = useConnections();
  const imageConnectionsList = useMemo(
    () =>
      ((connections as Array<{ id: string; name: string; model?: string; provider?: string }>) ?? []).filter(
        (c) => c.provider === "image_generation",
      ),
    [connections],
  );
  const textConnectionsList = useMemo(
    () =>
      ((connections as Array<{ id: string; name: string; model?: string; provider?: string }>) ?? []).filter(
        (c) => c.provider !== "image_generation",
      ),
    [connections],
  );
  const { data: allPersonas } = usePersonas();
  const { data: agentConfigs } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const { data: customToolCapabilities } = useCustomToolCapabilities();
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
  const isSceneChat = metadata.sceneStatus === "active" || typeof metadata.sceneOriginChatId === "string";
  const hasGeneratedConversationSchedules =
    !!metadata.characterSchedules &&
    typeof metadata.characterSchedules === "object" &&
    Object.keys(metadata.characterSchedules).length > 0;
  const conversationSchedulesEnabled =
    metadata.conversationSchedulesEnabled === true ||
    (metadata.conversationSchedulesEnabled == null && hasGeneratedConversationSchedules);
  const activeLorebookIds = useMemo<string[]>(
    () => (Array.isArray(metadata.activeLorebookIds) ? metadata.activeLorebookIds : []),
    [metadata.activeLorebookIds],
  );
  const activeLorebooks = useMemo<ActiveLorebookView[]>(() => {
    const pinnedIds = new Set(activeLorebookIds);
    const lorebookList = (lorebooks ?? []) as Lorebook[];

    return lorebookList.flatMap((lorebook) => {
      const reasons: LorebookActiveReason[] = [];
      const isPinned = pinnedIds.has(lorebook.id);

      if (lorebook.enabled !== false) {
        if (isPinned) reasons.push("Chat");
        if (lorebook.isGlobal) reasons.push("Global");
        if (
          lorebook.characterIds?.some((id) => chatCharIds.includes(id)) ||
          (lorebook.characterId && chatCharIds.includes(lorebook.characterId))
        ) {
          reasons.push("Character");
        }
        if (
          chat.personaId &&
          (lorebook.personaIds?.includes(chat.personaId) || lorebook.personaId === chat.personaId)
        ) {
          reasons.push("Persona");
        }
        if (lorebook.chatId === chat.id && !reasons.includes("Chat")) reasons.push("Chat");
      }

      return reasons.length > 0 ? [{ ...lorebook, activeReasons: reasons, isPinned }] : [];
    });
  }, [activeLorebookIds, chat.id, chat.personaId, chatCharIds, lorebooks]);
  const activeLorebookIdSet = useMemo(
    () => new Set(activeLorebooks.map((lorebook) => lorebook.id)),
    [activeLorebooks],
  );
  const lorebookTokenBudget =
    typeof metadata.lorebookTokenBudget === "number" && Number.isFinite(metadata.lorebookTokenBudget)
      ? Math.max(0, Math.floor(metadata.lorebookTokenBudget))
      : LIMITS.DEFAULT_LOREBOOK_TOKEN_BUDGET;
  const activeAgentIds = useMemo<string[]>(() => metadata.activeAgentIds ?? [], [metadata.activeAgentIds]);
  const activeToolIds: string[] = metadata.activeToolIds ?? [];
  const gameLorebookKeeperEnabled = metadata.gameLorebookKeeperEnabled === true;
  const gameLorebookKeeperLorebookId =
    typeof metadata.gameLorebookKeeperLorebookId === "string" ? metadata.gameLorebookKeeperLorebookId : null;
  const gameLorebookKeeperLorebook = gameLorebookKeeperLorebookId
    ? ((lorebooks ?? []) as Array<{ id: string; name: string }>).find(
        (book) => book.id === gameLorebookKeeperLorebookId,
      )
    : null;
  const gameAgentFeatureCount = (metadata.enableAgents ? 1 : 0) + (gameLorebookKeeperEnabled ? 1 : 0);
  const spriteCharacterIds: string[] = Array.isArray(metadata.spriteCharacterIds) ? metadata.spriteCharacterIds : [];
  const spritePosition: "left" | "right" = metadata.spritePosition === "right" ? "right" : "left";
  const spriteScale = normalizeSpriteDisplayValue(metadata.spriteScale, 1, 0.5, 1.75);
  const spriteOpacity = normalizeSpriteDisplayValue(metadata.spriteOpacity, 1, 0.15, 1);
  const [spriteScalePercent, setSpriteScalePercent] = useState(() => Math.round(spriteScale * 100));
  const [spriteOpacityPercent, setSpriteOpacityPercent] = useState(() => Math.round(spriteOpacity * 100));
  const hasCustomSpritePlacements = Object.keys(normalizeSpritePlacements(metadata.spritePlacements)).length > 0;

  useEffect(() => {
    setSpriteScalePercent(Math.round(spriteScale * 100));
  }, [spriteScale]);

  useEffect(() => {
    setSpriteOpacityPercent(Math.round(spriteOpacity * 100));
  }, [spriteOpacity]);

  const agentConfigsByType = useMemo(() => {
    const map = new Map<string, AgentConfigRow>();
    for (const config of (agentConfigs ?? []) as AgentConfigRow[]) {
      map.set(config.type, config);
    }
    return map;
  }, [agentConfigs]);

  // Build the available agent list: built-in + custom agents from DB
  // In roleplay mode, hide agents that are either automatic or handled internally.
  const availableAgents = useMemo(() => {
    const agents: AvailableAgent[] = [];
    for (const a of BUILT_IN_AGENTS) {
      if (HIDDEN_ROLEPLAY_AGENTS.has(a.id)) continue;
      const existing = agentConfigsByType.get(a.id);
      agents.push({
        id: a.id,
        name: existing?.name ?? a.name,
        description: existing?.description ?? a.description,
        category: a.category,
        phase: a.phase,
        builtIn: true,
      });
    }
    // Custom agents from DB
    if (agentConfigs) {
      for (const c of agentConfigs as AgentConfigRow[]) {
        if (!BUILT_IN_AGENTS.some((b) => b.id === c.type)) {
          agents.push({
            id: c.type,
            name: c.name,
            description: c.description,
            category: "custom",
            phase: c.phase as AgentPhase,
            builtIn: false,
          });
        }
      }
    }
    return agents;
  }, [agentConfigs, agentConfigsByType]);

  // Estimate the per-turn cost of the active agent loadout — feeds the readout
  // in the agents picker header and the per-row token badges. Approximate; see
  // `estimateAgentLoadCost` doc comment for what's counted vs not.
  const agentLoadCost = useMemo(() => {
    const inputs = activeAgentIds.flatMap((id) => {
      const meta = availableAgents.find((a) => a.id === id);
      if (!meta) return [];
      const cfg = agentConfigsByType.get(id);
      // `||` (not `??`) — custom configs often have an empty-string promptTemplate
      // meaning "no override", and we still want to count the built-in default.
      const promptTemplate = cfg?.promptTemplate || DEFAULT_AGENT_PROMPTS[id] || "";
      return [
        {
          type: id,
          phase: meta.phase,
          connectionId: cfg?.connectionId ?? null,
          promptTemplate,
        },
      ];
    });
    const tokensByType = new Map<string, number>(inputs.map((i) => [i.type, Math.ceil(i.promptTemplate.length / 4)]));
    return {
      cost: estimateAgentLoadCost(inputs, chat.connectionId ?? null),
      tokensByType,
    };
  }, [activeAgentIds, availableAgents, agentConfigsByType, chat.connectionId]);

  const lorebookKeeperConfig = agentConfigsByType.get("lorebook-keeper") ?? null;
  const lorebookKeeperEnabledByDefault = isEnabledFlag(lorebookKeeperConfig?.enabled);
  const lorebookKeeperActive =
    activeAgentIds.includes("lorebook-keeper") || (activeAgentIds.length === 0 && lorebookKeeperEnabledByDefault);
  const expressionConfig = agentConfigsByType.get("expression") ?? null;
  const expressionEnabledByDefault = isEnabledFlag(expressionConfig?.enabled);
  const expressionActive =
    activeAgentIds.includes("expression") || (activeAgentIds.length === 0 && expressionEnabledByDefault);
  const lorebookKeeperTargetLorebookId =
    typeof metadata.lorebookKeeperTargetLorebookId === "string" ? metadata.lorebookKeeperTargetLorebookId : "";
  const lorebookKeeperReadBehindMessages = normalizeNonNegativeInteger(
    metadata.lorebookKeeperReadBehindMessages,
    0,
    100,
  );

  // Build the available tool list: built-in + custom tools from DB
  const availableTools = useMemo(() => {
    const tools: Array<{ id: string; name: string; description: string }> = [];
    for (const t of BUILT_IN_TOOLS) {
      tools.push({ id: t.name, name: t.name, description: t.description });
    }
    if (customTools) {
      for (const ct of customTools as CustomToolRow[]) {
        if (isCustomToolSelectable(ct, customToolCapabilities)) {
          tools.push({ id: ct.name, name: ct.name, description: ct.description });
        }
      }
    }
    return tools;
  }, [customToolCapabilities, customTools]);

  // ── Helpers ──
  const characters = useMemo(
    () =>
      (allCharacters ?? []) as Array<{
        id: string;
        data: string;
        comment?: string | null;
        avatarPath: string | null;
      }>,
    [allCharacters],
  );

  const chatCharacters = useMemo(
    () =>
      chatCharIds
        .map((characterId) => characters.find((character) => character.id === characterId))
        .filter((character): character is { id: string; data: string; avatarPath: string | null } => !!character),
    [chatCharIds, characters],
  );

  const chatSpriteQueries = useQueries({
    queries: chatCharacters.map((character) => ({
      queryKey: ["sprites", character.id],
      queryFn: () => api.get<SpriteInfo[]>(`/sprites/${character.id}`),
      enabled: !!character.id,
      staleTime: 5 * 60_000,
    })),
  });

  const chatCharactersWithSprites = chatCharacters.filter((character, index) => {
    const sprites = chatSpriteQueries[index]?.data;
    return Array.isArray(sprites) && sprites.length > 0;
  });
  const chatCharactersLoading = chatCharIds.length > 0 && allCharacters == null;
  const chatSpriteChoicesLoading =
    chatCharacters.length > 0 &&
    chatCharactersWithSprites.length === 0 &&
    chatSpriteQueries.some((query) => query.isLoading);

  // Memoize character name parsing — avoids repeated JSON.parse per render
  const charInfoMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseCharacterDisplayData>>();
    for (const c of characters) {
      map.set(c.id, parseCharacterDisplayData(c));
    }
    return map;
  }, [characters]);

  const charNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, info] of charInfoMap) {
      map.set(id, info.name);
    }
    return map;
  }, [charInfoMap]);

  const getCharacterInfo = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => {
      if (c.id && charInfoMap.has(c.id)) return charInfoMap.get(c.id)!;
      return parseCharacterDisplayData(c);
    },
    [charInfoMap],
  );

  const charName = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => getCharacterInfo(c).name,
    [getCharacterInfo],
  );

  const charTitle = useCallback(
    (c: { id?: string; data: string; comment?: string | null }) => getCharacterTitle(getCharacterInfo(c)),
    [getCharacterInfo],
  );

  const charAvatarCrop = useCallback((c: { data: unknown }) => {
    try {
      const parsed = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
      return (
        ((parsed as { extensions?: { avatarCrop?: AvatarCrop | null } } | null)?.extensions?.avatarCrop as
          | AvatarCrop
          | null
          | undefined) ?? null
      );
    } catch {
      return null;
    }
  }, []);

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
  const syncGamePartyMetadata = (nextCharacterIds: string[]) => {
    if (!isGame) return;
    const storedPartyIds: unknown[] = Array.isArray(metadata.gamePartyCharacterIds)
      ? metadata.gamePartyCharacterIds
      : Array.isArray((metadata.gameSetupConfig as { partyCharacterIds?: unknown[] } | undefined)?.partyCharacterIds)
        ? (metadata.gameSetupConfig as { partyCharacterIds: unknown[] }).partyCharacterIds
        : [];
    const npcPartyIds = storedPartyIds.filter((id): id is string => typeof id === "string" && id.startsWith("npc:"));
    const nextPartyIds = Array.from(new Set([...nextCharacterIds, ...npcPartyIds]));
    const gameSetupConfig =
      metadata.gameSetupConfig && typeof metadata.gameSetupConfig === "object"
        ? { ...(metadata.gameSetupConfig as Record<string, unknown>), partyCharacterIds: nextPartyIds }
        : metadata.gameSetupConfig;
    updateMeta.mutate({
      id: chat.id,
      gamePartyCharacterIds: nextPartyIds,
      ...(gameSetupConfig ? { gameSetupConfig } : {}),
    });
  };

  const toggleCharacter = (charId: string) => {
    const current = [...chatCharIds];
    const idx = current.indexOf(charId);
    if (idx >= 0) {
      current.splice(idx, 1);
      updateChat.mutate(
        { id: chat.id, characterIds: current },
        {
          onSuccess: () => syncGamePartyMetadata(current),
        },
      );
      if (spriteCharacterIds.includes(charId)) {
        const nextSpritePlacements = { ...normalizeSpritePlacements(metadata.spritePlacements) };
        delete nextSpritePlacements[charId];
        updateMeta.mutate({
          id: chat.id,
          spriteCharacterIds: spriteCharacterIds.filter((id) => id !== charId),
          spritePlacements: nextSpritePlacements,
        });
      }
    } else {
      current.push(charId);
      updateChat.mutate(
        { id: chat.id, characterIds: current },
        {
          onSuccess: () => {
            syncGamePartyMetadata(current);
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

  const setSpriteScale = useCallback(
    (nextPercent: number) => {
      const clampedPercent = Math.max(50, Math.min(175, nextPercent));
      setSpriteScalePercent(clampedPercent);
      updateMeta.mutate({
        id: chat.id,
        spriteScale: clampedPercent / 100,
      });
    },
    [chat.id, updateMeta],
  );

  const setSpriteOpacity = useCallback(
    (nextPercent: number) => {
      const clampedPercent = Math.max(15, Math.min(100, nextPercent));
      setSpriteOpacityPercent(clampedPercent);
      updateMeta.mutate({
        id: chat.id,
        spriteOpacity: clampedPercent / 100,
      });
    },
    [chat.id, updateMeta],
  );

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

  const pinLorebookToChat = (lbId: string) => {
    if (activeLorebookIds.includes(lbId)) return;
    updateMeta.mutate({ id: chat.id, activeLorebookIds: [...activeLorebookIds, lbId] });
  };

  const hasSecretPlotMemory = (memory: Record<string, unknown> | null | undefined) => {
    if (!memory) return false;
    const arc = memory.overarchingArc;
    if (typeof arc === "string" && arc.trim()) return true;
    if (arc && typeof arc === "object") {
      const arcRecord = arc as Record<string, unknown>;
      if (
        String(arcRecord.description ?? "").trim() ||
        String(arcRecord.protagonistArc ?? "").trim() ||
        arcRecord.completed === true
      ) {
        return true;
      }
    }

    const sceneDirections = memory.sceneDirections;
    if (
      Array.isArray(sceneDirections) &&
      sceneDirections.some(
        (entry) =>
          typeof entry === "string"
            ? entry.trim()
            : !!(entry && typeof entry === "object" && String((entry as Record<string, unknown>).direction ?? "").trim()),
      )
    ) {
      return true;
    }

    const pacing = memory.pacing;
    if (typeof pacing === "string" ? pacing.trim() : pacing != null) return true;
    const recentlyFulfilled = memory.recentlyFulfilled;
    return Array.isArray(recentlyFulfilled) && recentlyFulfilled.some((entry) => String(entry ?? "").trim());
  };

  const toggleAgent = async (agentId: string) => {
    const readLatestActiveAgentIds = () => {
      const latestChat = qc.getQueryData<Chat>(chatKeys.detail(chat.id));
      return latestChat ? getChatActiveAgentIds(latestChat) : [...activeAgentIds];
    };
    const wasRemoving = readLatestActiveAgentIds().includes(agentId);
    if (wasRemoving && agentId === "secret-plot-driver") {
      let shouldWarn: boolean;
      try {
        const res = await api.get<{ memory: Record<string, unknown> }>(`/agents/memory/${agentId}/${chat.id}`);
        shouldWarn = hasSecretPlotMemory(res.memory);
      } catch {
        shouldWarn = true;
      }
      if (shouldWarn) {
        const ok = await showConfirmDialog({
          title: "Remove Secret Plot Driver",
          message:
            "Remove Secret Plot Driver from this chat? This will wipe its hidden plot memory for this chat, including the current arc and scene directions. This cannot be undone.",
          confirmLabel: "Remove Agent",
          tone: "destructive",
        });
        if (!ok) return;
      }
    }

    const current = readLatestActiveAgentIds();
    const idx = current.indexOf(agentId);
    const isRemoving = idx >= 0;
    if (isRemoving) current.splice(idx, 1);
    else current.push(agentId);
    let metadataSaved = false;
    try {
      await updateMeta.mutateAsync(
        { id: chat.id, activeAgentIds: current },
        {
          onSuccess: async () => {
            metadataSaved = true;
            // When removing an agent that stores persistent memory, clean it up after metadata is saved.
            if (isRemoving && agentId === "secret-plot-driver") {
              await api.delete(`/agents/memory/${agentId}/${chat.id}`);
            }
          },
        },
      );
    } catch (error) {
      if (metadataSaved && isRemoving && agentId === "secret-plot-driver") {
        const rollbackIds = Array.from(new Set([...readLatestActiveAgentIds(), agentId]));
        await updateMeta.mutateAsync({ id: chat.id, activeAgentIds: rollbackIds }).catch(() => undefined);
      }
      await showAlertDialog({
        title: isRemoving ? "Couldn't Remove Agent" : "Couldn't Add Agent",
        message:
          error instanceof Error
            ? error.message
            : "The agent list could not be updated. Please try again.",
      });
    }
  };

  const handleLorebookKeeperBackfill = useCallback(async () => {
    await retryAgents(chat.id, ["lorebook-keeper"], { lorebookKeeperBackfill: true });
  }, [chat.id, retryAgents]);

  const toggleTool = (toolId: string) => {
    const current = [...activeToolIds];
    const idx = current.indexOf(toolId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(toolId);
    updateMeta.mutate({ id: chat.id, activeToolIds: current });
  };

  const currentPromptPresetHasVariables = (currentPromptPresetFull?.choiceBlocks?.length ?? 0) > 0;
  const currentPromptPresetHasLorebookMarker = useMemo(() => {
    const sections = currentPromptPresetFull?.sections ?? [];
    return sections.some((section) => {
      const enabled = (section as { enabled?: boolean | string }).enabled;
      const isMarker = (section as { isMarker?: boolean | string }).isMarker;
      if (enabled === false || enabled === "false") return false;
      if (isMarker !== true && isMarker !== "true") return false;
      try {
        const config =
          typeof section.markerConfig === "string" ? JSON.parse(section.markerConfig) : section.markerConfig;
        return (
          config?.type === "lorebook" ||
          config?.type === "world_info_before" ||
          config?.type === "world_info_after"
        );
      } catch {
        return false;
      }
    });
  }, [currentPromptPresetFull?.sections]);
  const hasScopedOrGlobalLorebooks = useMemo(() => {
    return ((lorebooks ?? []) as Array<{
      id: string;
      enabled?: boolean;
      isGlobal?: boolean;
      characterId?: string | null;
      characterIds?: string[];
      personaId?: string | null;
      personaIds?: string[];
      chatId?: string | null;
    }>).some(
      (lorebook) =>
        lorebook.enabled !== false &&
        (lorebook.isGlobal ||
          activeLorebookIds.includes(lorebook.id) ||
          lorebook.characterIds?.some((id) => chatCharIds.includes(id)) ||
          (lorebook.characterId && chatCharIds.includes(lorebook.characterId)) ||
          (chat.personaId && lorebook.personaIds?.includes(chat.personaId)) ||
          (lorebook.personaId && lorebook.personaId === chat.personaId) ||
          (lorebook.chatId && lorebook.chatId === chat.id)),
    );
  }, [activeLorebookIds, chat.id, chat.personaId, chatCharIds, lorebooks]);
  const showLorebookMarkerWarning =
    !!chat.promptPresetId && hasScopedOrGlobalLorebooks && !currentPromptPresetHasLorebookMarker;

  const setPreset = (presetId: string | null) => {
    updateChat.mutate(
      { id: chat.id, promptPresetId: presetId },
      {
        onSuccess: async () => {
          if (!presetId) {
            setChoiceModalPresetId(null);
            return;
          }

          try {
            const presetFull = await api.get<{ choiceBlocks?: unknown[] }>(`/prompts/${presetId}/full`);
            if ((presetFull.choiceBlocks?.length ?? 0) > 0) {
              setChoiceModalPresetId(presetId);
            } else {
              setChoiceModalPresetId(null);
            }
          } catch {
            setChoiceModalPresetId(null);
          }
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
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showLbPicker, setShowLbPicker] = useState(false);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);
  const [showSummariesModal, setShowSummariesModal] = useState(false);
  const [showMemoriesModal, setShowMemoriesModal] = useState(false);
  // Session-ephemeral: did the user change Day Rollover Hour in this drawer mount?
  // Used to gate the "transitional duplication" warning so it only appears
  // immediately after a change (when the warning is operationally useful) and
  // doesn't permanently clutter chats that already have summaries.
  const [rolloverTouchedThisSession, setRolloverTouchedThisSession] = useState(false);
  useEffect(() => {
    setRolloverTouchedThisSession(false);
  }, [chat.id]);
  const [connectionSearch, setConnectionSearch] = useState("");
  const [personaSearch, setPersonaSearch] = useState("");
  const [pendingToolIds, setPendingToolIds] = useState<string[]>([]);
  const [charSearch, setCharSearch] = useState("");
  const [lbSearch, setLbSearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);
  const [agentAddPreview, setAgentAddPreview] = useState<AgentAddPreview | null>(null);
  const [agentAddCadenceInputFocused, setAgentAddCadenceInputFocused] = useState(false);
  const [addingAgentToChat, setAddingAgentToChat] = useState(false);
  const [isRegeneratingSchedules, setIsRegeneratingSchedules] = useState(false);
  // Synchronous lock to close the re-entry gap: React state commits are async, so two
  // fast clicks can both pass the `isRegeneratingSchedules` check before the state updates.
  const isRegeneratingSchedulesRef = useRef(false);
  const generateConversationSchedules = useCallback(
    async (forceRefresh = false) => {
      if (isRegeneratingSchedulesRef.current) return;
      isRegeneratingSchedulesRef.current = true;
      setIsRegeneratingSchedules(true);
      try {
        const scheduleGenerationPreferences = useUIStore.getState().scheduleGenerationPreferences;
        await api.post("/conversation/schedule/generate", {
          chatId: chat.id,
          characterIds: chatCharIds,
          forceRefresh,
          scheduleGenerationPreferences,
        });
        qc.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
      } catch {
        // non-critical
      } finally {
        isRegeneratingSchedulesRef.current = false;
        setIsRegeneratingSchedules(false);
      }
    },
    [chat.id, chatCharIds, qc],
  );
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
  const setActiveChatPreset = useSetActiveChatPreset();
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

  useEffect(() => {
    if (!open) {
      setAgentAddPreview(null);
      setAddingAgentToChat(false);
    }
  }, [open]);

  const openAgentAddModal = (agent: AvailableAgent) => {
    setAgentAddCadenceInputFocused(false);
    const config = agentConfigsByType.get(agent.id) ?? null;
    const mergedSettings = {
      ...getDefaultBuiltInAgentSettings(agent.id),
      ...parseAgentSettings(config?.settings),
    };
    const intervalMeta = getAgentRunIntervalMeta(agent.id, agent.builtIn);
    setAgentAddPreview({
      agent,
      config,
      contextSize: normalizePositiveInteger(mergedSettings.contextSize, DEFAULT_AGENT_CONTEXT_SIZE, 200),
      maxTokens: normalizeAgentMaxTokens(mergedSettings.maxTokens),
      runInterval: intervalMeta
        ? normalizePositiveInteger(mergedSettings.runInterval, intervalMeta.defaultValue, intervalMeta.max)
        : null,
    });
  };

  const confirmAddAgent = async () => {
    if (!agentAddPreview) return;

    const { agent, config, contextSize, maxTokens, runInterval } = agentAddPreview;
    const normalizedMaxTokens = normalizeAgentMaxTokens(maxTokens);
    const builtInMeta = BUILT_IN_AGENTS.find((entry) => entry.id === agent.id) ?? null;
    const nextSettings: Record<string, unknown> = {
      ...getDefaultBuiltInAgentSettings(agent.id),
      ...parseAgentSettings(config?.settings),
      contextSize,
      maxTokens: normalizedMaxTokens,
    };
    const intervalMeta = getAgentRunIntervalMeta(agent.id, !!builtInMeta);
    if (intervalMeta && runInterval != null) {
      nextSettings.runInterval = runInterval;
    }
    if (builtInMeta && !Array.isArray(nextSettings.enabledTools)) {
      nextSettings.enabledTools = DEFAULT_AGENT_TOOLS[agent.id] ?? [];
    }

    setAddingAgentToChat(true);
    try {
      if (config) {
        await updateAgentConfig.mutateAsync({ id: config.id, enabled: true, settings: nextSettings });
      } else if (builtInMeta) {
        await createAgent.mutateAsync({
          type: builtInMeta.id,
          name: agent.name,
          description: agent.description,
          phase: agent.phase,
          enabled: true,
          connectionId: null,
          promptTemplate: "",
          settings: nextSettings,
        });
      }

      await updateMeta.mutateAsync({
        id: chat.id,
        activeAgentIds: Array.from(new Set([...activeAgentIds, agent.id])),
        ...(agent.id === "secret-plot-driver"
          ? {
              showSecretPlotPanel: true,
            }
          : {}),
      });
      setAgentAddPreview(null);
    } catch (error) {
      await showAlertDialog({
        title: "Couldn’t Add Agent",
        message: error instanceof Error ? error.message : "Failed to add the agent to this chat.",
      });
    } finally {
      setAddingAgentToChat(false);
    }
  };

  const agentAddIntervalMeta = agentAddPreview
    ? getAgentRunIntervalMeta(agentAddPreview.agent.id, agentAddPreview.agent.builtIn)
    : null;

  const snapshotCurrentPresetSettings = useCallback((): ChatPresetSettings => {
    return {
      connectionId: chat.connectionId ?? null,
      promptPresetId: isConversation ? null : (chat.promptPresetId ?? null),
      metadata: { ...metadata },
    };
  }, [chat.connectionId, chat.promptPresetId, isConversation, metadata]);

  const handleSelectPreset = (id: string) => {
    if (!id || id === selectedChatPreset?.id) return;
    applyChatPreset.mutate({ presetId: id, chatId: chat.id });
  };

  const handleToggleDefaultPreset = () => {
    if (!selectedChatPreset || selectedChatPreset.isActive) return;
    setActiveChatPreset.mutate(selectedChatPreset.id);
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

  const handleSaveAsPreset = async () => {
    if (!selectedChatPreset) return;
    const baseName = await showPromptDialog({
      title: "Duplicate Preset",
      message: "Name for the new preset:",
      defaultValue: `${selectedChatPreset.name} Copy`,
      confirmLabel: "Create",
    });
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

  const handleDeletePreset = async () => {
    if (!selectedChatPreset || selectedChatPreset.isDefault) return;
    const ok = await showConfirmDialog({
      title: "Delete Preset",
      message: `Delete preset "${selectedChatPreset.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
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
      await showAlertDialog({
        title: "Import Failed",
        message: `Failed to import preset: ${err instanceof Error ? err.message : "Invalid file"}`,
        tone: "destructive",
      });
    }
  };

  const saveName = () => {
    if (nameVal.trim() && nameVal !== chat.name) {
      updateChat.mutate({ id: chat.id, name: nameVal.trim() });
    }
    setEditingName(false);
  };

  const renderMemoryRecallControls = (defaultOn: boolean) => {
    const effectiveValue = metadata.enableMemoryRecall !== undefined ? metadata.enableMemoryRecall === true : defaultOn;
    return (
      <div className="space-y-2">
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
              Recall relevant fragments from earlier in this chat and inject them as context.
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
        <button
          type="button"
          onClick={() => setShowMemoriesModal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
        >
          <Brain size="0.75rem" />
          Access memories for this chat
        </button>
      </div>
    );
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

        {/* Chat Settings Preset bar — hidden in Game Mode and scene chats. */}
        {!isGame && !isSceneChat && (
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
              <button
                onClick={handleToggleDefaultPreset}
                disabled={!selectedChatPreset || selectedChatPreset.isActive || setActiveChatPreset.isPending}
                title={
                  !selectedChatPreset
                    ? "Select a preset to mark it as default"
                    : selectedChatPreset.isActive
                      ? "This preset is the default for new chats in this mode"
                      : "Mark this preset as default for new chats in this mode"
                }
                aria-pressed={!!selectedChatPreset?.isActive}
                aria-label={selectedChatPreset?.isActive ? "Default preset" : "Mark as default preset"}
                className={cn(
                  "shrink-0 flex items-center justify-center rounded-md p-1.5 transition-colors disabled:cursor-not-allowed",
                  selectedChatPreset?.isActive
                    ? "text-yellow-400 disabled:opacity-100"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-yellow-400 disabled:opacity-40",
                )}
              >
                <Star
                  size="0.875rem"
                  fill={selectedChatPreset?.isActive ? "currentColor" : "none"}
                  strokeWidth={selectedChatPreset?.isActive ? 1.5 : 2}
                />
              </button>
              <HelpTooltip
                side="left"
                text={
                  isConversation
                    ? "Presets bundle this chat's connection, tools, translation, memory recall, advanced parameters, and other settings. Prompt presets are not applied in conversation mode. Characters, persona, lorebooks, sprites, summary, tags, and scene prompt stay tied to the chat. Star a preset to use it as the default for new chats in this mode."
                    : "Presets bundle this chat's connection, prompt preset, agents, tools, translation, memory recall, advanced parameters, and other settings. They never touch your characters, persona, lorebooks, sprites, summary, tags, or scene prompt — those stay tied to the chat. Star a preset to use it as the default for new chats in this mode."
                }
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
          {/* Hardcoded — CHAT_MODES.defaultAgents looks like the source of truth but is currently
              unused, and wouldn't cover non-agent built-ins (GM pipeline, autonomous messaging, etc.) anyway. */}
          {MODE_INTROS[chatMode as ChatMode] && (
            <div className="border-b border-[var(--border)] px-4 py-2.5">
              <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                {MODE_INTROS[chatMode as ChatMode]}
              </p>
            </div>
          )}

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
                    GM / Party Model
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
                      {p.name}
                    </option>
                  ))}
                </select>
                {chat.promptPresetId && currentPromptPresetHasVariables && (
                  <button
                    onClick={() => setChoiceModalPresetId(chat.promptPresetId!)}
                    className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Edit preset variables"
                  >
                    <Pencil size="0.8125rem" />
                  </button>
                )}
              </div>
              {showLorebookMarkerWarning && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[0.6875rem] text-amber-200 ring-1 ring-amber-400/25">
                  <AlertTriangle size="0.75rem" className="mt-[0.125rem] shrink-0" />
                  <span>This preset has active lorebooks available, but no lorebook marker.</span>
                </div>
              )}
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
                      const title = charTitle(c);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{name}</span>
                            {title && (
                              <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                {title}
                              </span>
                            )}
                          </div>
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
                    .filter((c) => {
                      const query = charSearch.toLowerCase();
                      const title = charTitle(c)?.toLowerCase() ?? "";
                      return charName(c).toLowerCase().includes(query) || title.includes(query);
                    })
                    .map((c) => {
                      const name = charName(c);
                      const title = charTitle(c);
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            toggleCharacter(c.id);
                            setShowCharPicker(false);
                          }}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{name}</span>
                            {title && (
                              <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                {title}
                              </span>
                            )}
                          </div>
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
                    const title = charTitle(c);
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
                              <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-full">
                                <img
                                  src={c.avatarPath}
                                  alt={name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                  style={getAvatarCropStyle(charAvatarCrop(c))}
                                />
                              </span>
                            ) : (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
                                {name[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs">{name}</span>
                              {title && (
                                <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                  {title}
                                </span>
                              )}
                            </div>
                          </button>
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
                    .filter((c) => {
                      const query = charSearch.toLowerCase();
                      const title = charTitle(c)?.toLowerCase() ?? "";
                      return charName(c).toLowerCase().includes(query) || title.includes(query);
                    })
                    .map((c) => {
                      const name = charName(c);
                      const title = charTitle(c);
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
                            <span className="block h-6 w-6 shrink-0 overflow-hidden rounded-full">
                              <img
                                src={c.avatarPath}
                                alt={name}
                                loading="lazy"
                                className="h-full w-full object-cover"
                                style={getAvatarCropStyle(charAvatarCrop(c))}
                              />
                            </span>
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                              {name[0]}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{name}</span>
                            {title && (
                              <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                {title}
                              </span>
                            )}
                          </div>
                          <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                        </button>
                      );
                    })}
                  {characters
                    .filter((c) => !chatCharIds.includes(c.id))
                    .filter((c) => {
                      const query = charSearch.toLowerCase();
                      const title = charTitle(c)?.toLowerCase() ?? "";
                      return charName(c).toLowerCase().includes(query) || title.includes(query);
                    }).length === 0 && (
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

          {isConversation && (
            <Section
              label="Manual Replies"
              icon={<MessageCircle size="0.875rem" />}
              help="When enabled, conversation messages are saved without auto-generating a reply unless you @mention a character or trigger one from the input bar."
            >
              <button
                onClick={() =>
                  updateMeta.mutate({
                    id: chat.id,
                    groupResponseOrder: metadata.groupResponseOrder === "manual" ? "sequential" : "manual",
                  })
                }
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.groupResponseOrder === "manual"
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[0.6875rem] font-medium">Only Reply When Mentioned</span>
                  <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    {metadata.groupResponseOrder === "manual"
                      ? "Characters will stay quiet until you type @Name or use the character picker."
                      : "Characters reply automatically; @mentions focus the response on the mentioned character."}
                  </p>
                </div>
                <div
                  className={cn(
                    "ml-3 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.groupResponseOrder === "manual"
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.groupResponseOrder === "manual" && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </Section>
          )}

          {/* Group Chat Settings — only when 2+ characters, game mode handles it internally */}
          {chatCharIds.length > 1 && !isGame && !isConversation && (
            <Section
              label="Group Chat"
              icon={<Users size="0.875rem" />}
              help={
                isConversation
                  ? "Configure whether group conversations reply automatically or wait for a manually triggered character response."
                  : "Configure how multiple characters interact. Merged mode combines all characters into one narrator; Individual mode has each character respond separately."
              }
            >
              {/* Mode selector */}
              {!isConversation && (
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
              )}

              {/* Merged mode: speaker color option */}
              {!isConversation && (metadata.groupChatMode ?? "merged") === "merged" && (
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
              {!isConversation && metadata.groupChatMode === "individual" && (
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
              {!isConversation && (
                <div className="mt-2 space-y-1.5">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    Scenario Override
                  </label>
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
              )}
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

                {/* Conversation schedules toggle */}
                <button
                  onClick={() => {
                    const nextEnabled = !conversationSchedulesEnabled;
                    updateMeta.mutate({ id: chat.id, conversationSchedulesEnabled: nextEnabled });
                    if (nextEnabled && !hasGeneratedConversationSchedules) {
                      void generateConversationSchedules(false);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    conversationSchedulesEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Schedules</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Optional character routines for availability and delays
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      conversationSchedulesEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        conversationSchedulesEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

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
                    {imageConnectionsList.map((c) => (
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

                {/* Schedule generation preferences — free-form authorial guidance */}
                <label className="flex flex-col gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles size="0.75rem" className="text-[var(--primary)]" />
                    Schedule generation preferences
                    <HelpTooltip text="Free-form guidance that steers how character schedules are generated. Both directives ('no characters past midnight') and factual constraints ('I work 9-5') work. This setting is global — it applies to every conversation chat." />
                  </span>
                  <textarea
                    value={scheduleGenerationPreferences}
                    onChange={(e) => setScheduleGenerationPreferences(e.target.value)}
                    placeholder="e.g. Make everyone go to sleep before midnight. Give characters free time 10am-noon. I work 9-5 on weekdays."
                    className="min-h-[5rem] resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-[var(--muted-foreground)]/40"
                  />
                  <p className="text-[0.59375rem] text-[var(--muted-foreground)]/70">
                    Global setting. Applies to every conversation chat&apos;s next schedule regeneration — manual or
                    weekly auto.
                  </p>
                </label>

                {/* Active schedule-generation preference indicator */}
                {scheduleGenerationPreferences.trim() && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2.5"
                    title={scheduleGenerationPreferences.trim()}
                  >
                    <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-[0.6875rem] font-medium leading-snug text-[var(--foreground)]">
                        Schedule generation preference active
                      </span>
                      <p className="mt-0.5 truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                        “{scheduleGenerationPreferences.trim()}”
                      </p>
                      <p className="mt-1 text-[0.59375rem] text-[var(--muted-foreground)]/70">
                        Will be applied the next time schedules are regenerated.
                      </p>
                    </div>
                  </div>
                )}

                {/* Schedule status */}
                <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2.5">
                  <CalendarClock size="0.875rem" className="text-[var(--muted-foreground)]" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]">
                      {!conversationSchedulesEnabled
                        ? "Schedules are off — autonomous messages will not create routines."
                        : hasGeneratedConversationSchedules
                          ? "Schedules generated — status is derived from character routines."
                          : "Schedules enabled — generate routines when you're ready."}
                    </span>
                    <p className="text-[0.59375rem] text-[var(--muted-foreground)]/60 mt-0.5">
                      {conversationSchedulesEnabled
                        ? "Schedules refresh only after you enable or regenerate them."
                        : "Turn schedules on if you want character availability to matter."}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!conversationSchedulesEnabled) {
                        updateMeta.mutate({ id: chat.id, conversationSchedulesEnabled: true });
                      }
                      await generateConversationSchedules(true);
                    }}
                    disabled={isRegeneratingSchedules || chatCharIds.length === 0}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
                      isRegeneratingSchedules || chatCharIds.length === 0
                        ? "cursor-not-allowed text-[var(--muted-foreground)]/60"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                    )}
                    title={isRegeneratingSchedules ? "Regenerating schedules…" : "Generate schedules"}
                  >
                    <RefreshCw size="0.6875rem" className={cn(isRegeneratingSchedules && "animate-spin")} />
                    {isRegeneratingSchedules
                      ? "Regenerating…"
                      : hasGeneratedConversationSchedules
                        ? "Regenerate"
                        : "Generate"}
                  </button>
                </div>

                {/* Schedule editor per character */}
                {conversationSchedulesEnabled && hasGeneratedConversationSchedules && (
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

          {/* Connected Chat — conversation mode: link to a roleplay or game chat */}
          {isConversation && (
            <Section
              label="Connected Chat"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this conversation to a roleplay or game. Recent messages from the linked chat are pulled into context here automatically. To send something the other direction, the character uses `<influence>` (steers the next linked turn, one-shot) or `<note>` (persists on every future linked turn until cleared)."
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
                  <Plus size="0.75rem" /> Link to Roleplay or Game
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

          {/* Connected Conversation — roleplay mode: linked OOC chat + optional in-world DM command */}
          {isRoleplayMode && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help={
                'Link to an OOC conversation, and optionally let roleplay characters open direct-message conversations with `[dm: character="Name" message="text"]` when it naturally fits the scene.'
              }
            >
              <div className="space-y-2">
                {chat.connectedChatId ? (
                  (() => {
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
                  })()
                ) : (
                  <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    No OOC conversation is linked. Direct-message commands can still create new Conversation DMs.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() =>
                    updateMeta.mutate({
                      id: chat.id,
                      roleplayDmCommandsEnabled: metadata.roleplayDmCommandsEnabled !== true,
                    })
                  }
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    metadata.roleplayDmCommandsEnabled === true
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] font-medium">Allow character DMs</span>
                    <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                      Adds a short hidden command reminder so characters can open a new DM conversation when they text
                      the user in-world.
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      metadata.roleplayDmCommandsEnabled === true
                        ? "bg-[var(--primary)]"
                        : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        metadata.roleplayDmCommandsEnabled === true && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
              </div>
            </Section>
          )}

          {/* Connected Conversation — game mode: show linked OOC chat */}
          {isGame && chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Linked to a conversation. `<influence>` tags from the conversation steer the next turn here (one-shot, then consumed). `<note>` tags persist on every turn until cleared. Raw conversation messages are not injected — use `<note>` for facts this chat should keep remembering."
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

          {/* Notes from Conversation — durable notes saved by the connected conversation's character */}
          {!isConversation && chat.connectedChatId && <ConversationNotesSection chatId={chat.id} />}

          {/* Connect to Conversation — game mode without existing link */}
          {chatMode === "game" && !chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this game to an OOC conversation. The conversation character uses `<influence>` (one-shot) or `<note>` (durable) to bridge content into the game; raw conversation messages are not injected. Game events and roleplay moments flow back into the conversation automatically."
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
            count={activeLorebooks.length}
            help="Lorebooks contain world info, character backstories, and lore that gets injected into the AI's context when relevant keywords appear."
         >
              <div className="mb-2 rounded-lg bg-[var(--secondary)]/70 p-3 ring-1 ring-[var(--border)]">
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                Lorebook Token Budget{" "}
                <HelpTooltip text={`Context cap for activated lorebook retrievals in this chat. Default: ${LIMITS.DEFAULT_LOREBOOK_TOKEN_BUDGET}. Set to 0 for unlimited.`} />
              </label>
              <input
                type="number"
                min={0}
                value={lorebookTokenBudget}
                onChange={(event) => {
                  const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                  updateMeta.mutate({ id: chat.id, lorebookTokenBudget: next });
                }}
                className="w-full rounded-lg bg-[var(--background)] px-3 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            {/* Active lorebooks */}
            {activeLorebooks.length === 0 ? (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No lorebooks active in this chat.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeLorebooks.map((lb) => {
                  return (
                    <div
                      key={lb.id}
                      className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                    >
                      <BookOpen size="0.875rem" className="text-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{lb.name}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {lb.activeReasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-[var(--background)]/70 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                      {lb.isPinned ? (
                        <button
                          onClick={() => toggleLorebook(lb.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove from chat"
                        >
                          <Trash2 size="0.6875rem" />
                        </button>
                      ) : (
                        <button
                          onClick={() => pinLorebookToChat(lb.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/15 hover:text-[var(--primary)]"
                          title="Add to chat"
                        >
                          <Plus size="0.6875rem" />
                        </button>
                      )}
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
                  .filter((lb) => !activeLorebookIdSet.has(lb.id))
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
                  .filter((lb) => !activeLorebookIdSet.has(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                    {((lorebooks ?? []) as Array<{ id: string }>).filter((lb) => !activeLorebookIdSet.has(lb.id))
                      .length === 0
                      ? "All available lorebooks are already active here."
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
              count={isGame ? gameAgentFeatureCount : activeAgentIds.length}
              help="When enabled, AI agents run automatically during generation to enrich the chat with world state tracking, expression detection, and more."
            >
              <div className="space-y-2">
                {isGame && metadata.enableAgents && (
                  <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]">
                    Toggle agents for this game session. Only two are allowed to ensure the game's format doesn't break.
                  </p>
                )}
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
                        ? "Analyse scenes for backgrounds, music, weather, and cinematic effects after each GM turn."
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
                      {import.meta.env.VITE_MARINARA_LITE !== "true" && <option value="">Local sidecar (Gemma)</option>}
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

                {isGame && (
                  <button
                    onClick={() => {
                      updateMeta.mutate({
                        id: chat.id,
                        gameLorebookKeeperEnabled: !gameLorebookKeeperEnabled,
                      });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      gameLorebookKeeperEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <BookOpen size="0.75rem" className="text-[var(--primary)]" />
                        <span>Game Lorebook Keeper</span>
                      </div>
                      <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                        Updates a game-scoped lorebook after End Session finishes and attaches it only to this game.
                      </p>
                      {gameLorebookKeeperLorebook && (
                        <p className="mt-0.5 truncate text-[0.55rem] text-[var(--primary)]/70">
                          Target: {gameLorebookKeeperLorebook.name}
                        </p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        gameLorebookKeeperEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          gameLorebookKeeperEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {metadata.enableAgents && !isGame && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium">
                          <BookOpen size="0.75rem" className="text-[var(--primary)]" />
                          <span>Lorebook Keeper</span>
                        </div>
                        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                          Pick a chat-specific target lorebook and optionally keep Lorebook Keeper a few assistant
                          replies behind the latest canon before it writes.
                        </p>
                      </div>
                      <button
                        onClick={handleLorebookKeeperBackfill}
                        disabled={agentProcessing || !lorebookKeeperActive}
                        className={cn(
                          "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.6875rem] font-medium transition-colors",
                          agentProcessing || !lorebookKeeperActive
                            ? "cursor-not-allowed bg-[var(--muted)] text-[var(--muted-foreground)]"
                            : "bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/15",
                        )}
                      >
                        <RefreshCw size="0.75rem" className={cn(agentProcessing && "animate-spin")} />
                        <span>Backfill Unprocessed</span>
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Target Lorebook</span>
                        <select
                          value={lorebookKeeperTargetLorebookId}
                          onChange={(e) =>
                            updateMeta.mutate({
                              id: chat.id,
                              lorebookKeeperTargetLorebookId: e.target.value || null,
                            })
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                        >
                          <option value="">Auto-select first writable lorebook</option>
                          {((lorebooks ?? []) as Array<{ id: string; name: string }>).map((lorebook) => (
                            <option key={lorebook.id} value={lorebook.id}>
                              {lorebook.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Read Behind</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={lorebookKeeperReadBehindMessages}
                          onChange={(e) => {
                            const nextValue = e.target.value === "" ? 0 : Number.parseInt(e.target.value, 10);
                            updateMeta.mutate({
                              id: chat.id,
                              lorebookKeeperReadBehindMessages: Number.isFinite(nextValue)
                                ? Math.max(0, Math.min(100, nextValue))
                                : 0,
                            });
                          }}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                        />
                      </label>
                    </div>

                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {lorebookKeeperActive
                        ? "Read-behind uses assistant messages: 0 means the newest eligible reply, 1 waits one reply, and backfill only processes messages Lorebook Keeper has not already saved."
                        : activeAgentIds.length === 0
                          ? "Lorebook Keeper is not currently enabled in this chat. These chat settings will apply once it is enabled."
                          : "Lorebook Keeper is not in this chat's active agent list. Add it below to make these settings take effect."}
                    </p>
                  </div>
                )}

                {metadata.enableAgents && !isGame && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-3">
                    <div className="flex items-start gap-2">
                      <Image size="0.75rem" className="mt-0.5 text-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium">
                          <span>Expression Engine Sprites</span>
                          {spriteCharacterIds.length > 0 && (
                            <span className="rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--primary)]">
                              {spriteCharacterIds.length}/3 enabled
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                          Choose which added characters can appear as VN sprites and control the sprite layout for this
                          chat.
                        </p>
                      </div>
                    </div>

                    {chatCharIds.length === 0 ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Add characters to this chat first to enable sprite selection.
                      </p>
                    ) : chatCharactersLoading ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">Loading added characters...</p>
                    ) : chatCharactersWithSprites.length > 0 ? (
                      <div className="space-y-1.5">
                        {chatCharactersWithSprites.map((character) => {
                          const name = charName(character);
                          const title = charTitle(character);
                          const spriteActive = spriteCharacterIds.includes(character.id);

                          return (
                            <div
                              key={character.id}
                              className="flex items-center gap-2.5 rounded-lg bg-[var(--background)]/75 px-3 py-2 ring-1 ring-[var(--border)]"
                            >
                              <button
                                onClick={() => {
                                  onClose();
                                  useUIStore.getState().openCharacterDetail(character.id);
                                }}
                                className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:opacity-80"
                                title="Open character card"
                              >
                                {character.avatarPath ? (
                                  <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full">
                                    <img
                                      src={character.avatarPath}
                                      alt={name}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                      style={getAvatarCropStyle(charAvatarCrop(character))}
                                    />
                                  </span>
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
                                    {name[0]}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium">{name}</span>
                                  {title && (
                                    <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                      {title}
                                    </span>
                                  )}
                                  <span className="block text-[0.625rem] text-[var(--muted-foreground)]">
                                    Uploaded sprites available
                                  </span>
                                </div>
                              </button>

                              <SpriteToggleButton
                                active={spriteActive}
                                disabled={!spriteActive && spriteCharacterIds.length >= 3}
                                onToggle={() => toggleSprite(character.id)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : chatSpriteChoicesLoading ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Checking added characters for uploaded sprites...
                      </p>
                    ) : (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        None of the added characters have uploaded sprites yet. Open a character card to add them first.
                      </p>
                    )}

                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {expressionActive
                        ? "Only added characters with uploaded sprites appear here. You can enable up to 3 at a time."
                        : activeAgentIds.length === 0
                          ? "Expression Engine is not currently enabled in this chat. These sprite choices will apply once it is enabled."
                          : "Expression Engine is not in this chat's active agent list. Add it below to show sprites during roleplay."}
                    </p>

                    {spriteCharacterIds.length > 0 && (
                      <div className="rounded-lg bg-[var(--background)]/75 px-3 py-2 ring-1 ring-[var(--border)]">
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
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                            Default Side
                          </span>
                          <div className="flex rounded-md ring-1 ring-[var(--border)]">
                            <button
                              onClick={() => setSpriteSide("left")}
                              className={cn(
                                "rounded-l-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors",
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
                                "rounded-r-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors",
                                spritePosition === "right"
                                  ? "bg-[var(--primary)] text-white"
                                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                              )}
                            >
                              Right
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <SpriteRangeSlider
                            label="Size"
                            value={spriteScalePercent}
                            min={50}
                            max={175}
                            step={5}
                            suffix="%"
                            onChange={setSpriteScale}
                          />
                          <SpriteRangeSlider
                            label="Opacity"
                            value={spriteOpacityPercent}
                            min={15}
                            max={100}
                            step={5}
                            suffix="%"
                            onChange={setSpriteOpacity}
                          />
                        </div>

                        <p className="mt-2 text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]">
                          Arrange mode lets you drag sprites anywhere in the chat area. Reset clears saved positions.
                          Changing the side flips the current layout.
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
                          Auto-generate NPC portraits and location backgrounds during gameplay.
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
                        {/* Approximate per-turn cost of the active agent loadout. */}
                        <div
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.6875rem] ring-1",
                            agentLoadCost.cost.level === "high"
                              ? "bg-amber-400/10 text-amber-400/90 ring-amber-400/30"
                              : "bg-[var(--secondary)]/60 text-[var(--muted-foreground)] ring-[var(--border)]",
                          )}
                          title={`Approximate. Each call also carries chat context (recent messages, characters, persona, lorebook), so real per-turn token use is higher. Smaller models may slow down or fail past ~${AGENT_COST_HIGH_CALLS} calls or ~${AGENT_COST_HIGH_TOKENS.toLocaleString()} instruction tokens.`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            {agentLoadCost.cost.level === "high" && (
                              <AlertTriangle size="0.75rem" className="shrink-0" />
                            )}
                            <span className="truncate">
                              ~{agentLoadCost.cost.instructionTokens.toLocaleString()} tokens of agent instructions
                              {" · "}~{agentLoadCost.cost.extraCalls} extra call
                              {agentLoadCost.cost.extraCalls === 1 ? "" : "s"}/turn
                            </span>
                          </span>
                          <span className="shrink-0 cursor-help text-[0.625rem] opacity-70">ⓘ</span>
                        </div>

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
                              {cat.key === "writer" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateMeta.mutate({
                                      id: chat.id,
                                      showInjectionsPanel: metadata.showInjectionsPanel !== true,
                                    })
                                  }
                                  aria-pressed={metadata.showInjectionsPanel === true}
                                  className="ml-auto flex w-fit max-w-full items-center gap-2 rounded-md bg-[var(--background)]/20 px-1.5 py-1 text-left text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/35 hover:text-[var(--foreground)]"
                                  title={
                                    metadata.showInjectionsPanel === true
                                      ? "Hide the Injections tab in the roleplay Agents menu. This is mainly for troubleshooting Prose Guardian, Narrative Director, or custom injected text before regenerating the current reply."
                                      : "Show the Injections tab in the roleplay Agents menu. This is mainly for troubleshooting Prose Guardian, Narrative Director, or custom injected text before regenerating the current reply."
                                  }
                                >
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <FilePlus2 size="0.625rem" className="shrink-0 text-[var(--primary)]" />
                                    <span className="truncate font-medium">Injections tab</span>
                                  </span>
                                  <span
                                    className={cn(
                                      "h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
                                      metadata.showInjectionsPanel === true
                                        ? "bg-[var(--primary)]"
                                        : "bg-[var(--muted-foreground)]/50",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
                                        metadata.showInjectionsPanel === true && "translate-x-2.5",
                                      )}
                                    />
                                  </span>
                                </button>
                              )}
                              {/* Active agents in this category */}
                              {activeInCat.length > 0 && (
                                <div className="flex flex-col gap-1 mb-1.5">
                                  {activeInCat.map((agent) => {
                                    const tokenEst = agentLoadCost.tokensByType.get(agent.id);
                                    const isSecretPlotDriver = agent.id === "secret-plot-driver";
                                    return (
                                      <div
                                        key={agent.id}
                                        className="rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                                      >
                                        <div className="flex items-start gap-2.5">
                                          <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <span className="block min-w-0 truncate text-xs">{agent.name}</span>
                                              {tokenEst != null ? (
                                                <span
                                                  className="shrink-0 tabular-nums text-[0.625rem] text-[var(--muted-foreground)]"
                                                  title={`~${tokenEst.toLocaleString()} tokens of agent instructions (estimated)`}
                                                >
                                                  ~{tokenEst.toLocaleString()}
                                                </span>
                                              ) : null}
                                            </div>
                                            <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
                                              {agent.description}
                                            </span>
                                          </div>
                                          <button
                                            onClick={() => {
                                              void toggleAgent(agent.id);
                                            }}
                                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                            title="Remove from chat"
                                          >
                                            <Trash2 size="0.6875rem" />
                                          </button>
                                        </div>
                                        {isSecretPlotDriver && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateMeta.mutate({
                                                id: chat.id,
                                                showSecretPlotPanel: metadata.showSecretPlotPanel !== true,
                                              })
                                            }
                                            aria-pressed={metadata.showSecretPlotPanel === true}
                                            className="ml-auto mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-md bg-[var(--background)]/20 px-1.5 py-1 text-left text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/35 hover:text-[var(--foreground)]"
                                            title={
                                              metadata.showSecretPlotPanel === true
                                                ? "Hide the Secret Plot tab in the roleplay Agents menu. That tab lets you inspect and edit the Secret Plot Driver's hidden arc memory and scene directions for this chat."
                                                : "Show the Secret Plot tab in the roleplay Agents menu. Use it to inspect and edit the Secret Plot Driver's hidden arc memory and scene directions for this chat."
                                            }
                                          >
                                            <span className="flex min-w-0 items-center gap-1.5">
                                              <Brain size="0.625rem" className="shrink-0 text-[var(--primary)]" />
                                              <span className="truncate font-medium">Secret Plot tab</span>
                                            </span>
                                            <span
                                              className={cn(
                                                "h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
                                                metadata.showSecretPlotPanel === true
                                                  ? "bg-[var(--primary)]"
                                                  : "bg-[var(--muted-foreground)]/50",
                                              )}
                                            >
                                              <span
                                                className={cn(
                                                  "block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
                                                  metadata.showSecretPlotPanel === true && "translate-x-2.5",
                                                )}
                                              />
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Available agents to add */}
                              {inactiveInCat.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {inactiveInCat.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => openAgentAddModal(agent)}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
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
                                  {activeCustom.map((agent) => {
                                    const tokenEst = agentLoadCost.tokensByType.get(agent.id);
                                    return (
                                      <div
                                        key={agent.id}
                                        className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                                      >
                                        <Sparkles size="0.875rem" className="text-[var(--primary)]" />
                                        <div className="flex-1 min-w-0">
                                          <span className="block truncate text-xs">{agent.name}</span>
                                        </div>
                                        {tokenEst != null ? (
                                          <span
                                            className="shrink-0 tabular-nums text-[0.625rem] text-[var(--muted-foreground)]"
                                            title={`~${tokenEst.toLocaleString()} tokens of agent instructions (estimated)`}
                                          >
                                            ~{tokenEst.toLocaleString()}
                                          </span>
                                        ) : null}
                                        <button
                                          onClick={() => {
                                            void toggleAgent(agent.id);
                                          }}
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
                              {inactiveCustom.length > 0 && (
                                <div className="flex flex-col gap-1">
                                  {inactiveCustom.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => openAgentAddModal(agent)}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
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
          {isConversation && import.meta.env.VITE_MARINARA_LITE !== "true" && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from this chat are automatically recalled and injected into the prompt as memories. Uses the local embedding model when available, or the configured embedding connection."
            >
              {renderMemoryRecallControls(true)}
            </Section>
          )}

          {/* Automatic Summarization — conversation mode only. Opens a modal to edit per-day and per-week summaries. */}
          {isConversation && (
            <Section
              label="Automatic Summarization"
              icon={<CalendarClock size="0.875rem" />}
              help="To help keep the request context low, the conversation is automatically summarized. Each day is wrapped up into a day summary. Likewise, day summaries are combined into week summaries. Chat messages that have been summarized are not added to context. Only the week summaries, the day summaries of the current week and today's messages are added to the context. This feature currently can't be disabled."
            >
              <div className="space-y-2.5">
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

                {/* Day rollover hour */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Clock size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Day Rollover Hour</span>
                  </div>
                  <select
                    value={(metadata.dayRolloverHour as number | undefined) ?? 4}
                    onChange={(e) => {
                      setRolloverTouchedThisSession(true);
                      updateMeta.mutate({ id: chat.id, dayRolloverHour: Number(e.target.value) });
                    }}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    {Array.from({ length: 12 }, (_, h) => {
                      const label = h === 0 ? "12 AM (midnight)" : `${h} AM`;
                      return (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Messages sent before this hour count as part of the previous day. Pick a time you&apos;re never
                    chatting, so a late-night session doesn&apos;t get cut off mid-conversation.
                  </p>
                  {rolloverTouchedThisSession &&
                    (((metadata.daySummaries as Record<string, unknown> | undefined) &&
                      Object.keys(metadata.daySummaries as Record<string, unknown>).length > 0) ||
                      ((metadata.weekSummaries as Record<string, unknown> | undefined) &&
                        Object.keys(metadata.weekSummaries as Record<string, unknown>).length > 0)) && (
                      <div className="flex items-start gap-1.5 rounded-md bg-amber-400/10 px-2 py-1.5 ring-1 ring-amber-400/20">
                        <AlertTriangle size="0.75rem" className="mt-[0.125rem] shrink-0 text-amber-400/80" />
                        <p className="text-[0.625rem] text-amber-400/80 leading-snug">
                          Existing summaries were built with the previous setting. For today, messages near the rollover
                          hour may be duplicated or missing from the prompt. From tomorrow onward, new day summaries
                          will line up correctly. To adjust an older summary, use{" "}
                          <span className="font-medium">Edit Summaries</span> above.
                        </p>
                      </div>
                    )}
                </div>

                {/* Recent message tail */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <MessageCircle size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Recent Message Tail</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={1}
                    value={(metadata.summaryTailMessages as number | undefined) ?? 10}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(50, Math.floor(raw))) : 10;
                      updateMeta.mutate({ id: chat.id, summaryTailMessages: clamped });
                    }}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    How many recent messages to keep word-for-word, even once they&apos;re summarized. Helps characters
                    pick up the actual flow of last night&apos;s conversation instead of just the gist. Set to{" "}
                    <span className="font-medium">0</span> to disable.
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* Discord Webhook */}
          <Section
            label="Discord Mirror"
            icon={<Globe size="0.875rem" />}
            help="Mirror messages from this chat to a Discord channel via webhook. Character messages appear under the character's name, and Game mode system narration uses narrator-style labels where needed."
          >
            <div className="space-y-2">
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Paste a Discord webhook URL to mirror this chat's messages to a channel. Character messages appear under
                their name, and game narration/party messages use simple speaker labels.
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

          {/* Memory Recall — roleplay/game modes: show after Function Calling */}
          {!isConversation && import.meta.env.VITE_MARINARA_LITE !== "true" && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from this chat are automatically recalled and injected into the prompt as memories. Uses the local embedding model when available, or the configured embedding connection."
            >
              {renderMemoryRecallControls(metadata.sceneStatus === "active")}
            </Section>
          )}

          {/* Translation */}
          <Section
            label="Translation"
            icon={<Languages size="0.875rem" />}
            help="Configure translation for this chat here, including provider, target language, and automatic response translation for Game mode."
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

              {/* Draft translate button toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, showInputTranslateButton: !metadata.showInputTranslateButton });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.showInputTranslateButton
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Show Draft Translate Button</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Add a translate button beside Send so you can translate and edit your message before sending it.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.showInputTranslateButton ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.showInputTranslateButton && "translate-x-3.5",
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

          {/* Impersonate (global settings applied to /impersonate generations) */}
          <Section
            label="Impersonate"
            icon={<Drama size="0.875rem" />}
            help="Global settings applied to every /impersonate generation across all chats."
          >
            <ImpersonateSettingsContent
              presets={(presets ?? []) as Array<{ id: string; name: string }>}
              connections={textConnectionsList}
            />
          </Section>
        </div>
      </div>

      {/* Choice selection modal for preset variables */}
      <ChoiceSelectionModal
        open={!!choiceModalPresetId}
        onClose={() => setChoiceModalPresetId(null)}
        presetId={choiceModalPresetId}
        chatId={chat.id}
        existingChoices={metadata.presetChoices ?? {}}
      />

      {/* Automatic summarization editor */}
      <SummariesEditorModal chat={chat} open={showSummariesModal} onClose={() => setShowSummariesModal(false)} />

      {/* Memory recall chunk viewer */}
      <MemoryRecallMemoriesModal
        chatId={chat.id}
        open={showMemoriesModal}
        onClose={() => setShowMemoriesModal(false)}
      />

      <Modal
        open={!!agentAddPreview}
        onClose={() => {
          if (!addingAgentToChat) setAgentAddPreview(null);
        }}
        title={agentAddPreview ? `Add ${agentAddPreview.agent.name}` : "Add Agent"}
        width="max-w-lg"
      >
        {agentAddPreview && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[var(--secondary)]/80 px-4 py-3 ring-1 ring-[var(--border)]">
              <div className="flex items-start gap-3">
                <Sparkles size="1rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{agentAddPreview.agent.name}</p>
                    <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[0.5625rem] uppercase tracking-wide text-[var(--muted-foreground)]">
                      {agentAddPreview.agent.builtIn ? agentAddPreview.agent.category : "custom"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--muted-foreground)]">
                    {agentAddPreview.agent.description || "No description available."}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[0.6875rem] font-semibold text-[var(--foreground)]">Agent Budget</label>
              <div className="grid gap-3 sm:grid-cols-2">
                {agentAddPreview.agent.id !== "chat-summary" ? (
                  <div>
                    <label className="mb-1 block text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      Context Size
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={agentAddPreview.contextSize}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  contextSize: Number.isFinite(value)
                                    ? Math.max(1, Math.min(200, value))
                                    : DEFAULT_AGENT_CONTEXT_SIZE,
                                }
                              : current,
                          );
                        }}
                        disabled={addingAgentToChat}
                        className="w-28 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="text-[0.6875rem] text-[var(--muted-foreground)]">messages</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--accent)]/50 px-3 py-2.5 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
                    Chat Summary context size is managed in the Chat Summary panel after you add the agent.
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                    Max Output Tokens
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={MIN_AGENT_MAX_TOKENS}
                      max={MAX_AGENT_MAX_TOKENS}
                      value={agentAddPreview.maxTokens}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        setAgentAddPreview((current) =>
                          current
                            ? {
                                ...current,
                                maxTokens: normalizeAgentMaxTokensInputValue(
                                  Number.isFinite(value) ? value : undefined,
                                ),
                              }
                            : current,
                        );
                      }}
                      onBlur={() => {
                        setAgentAddPreview((current) =>
                          current ? { ...current, maxTokens: normalizeAgentMaxTokens(current.maxTokens) } : current,
                        );
                      }}
                      disabled={addingAgentToChat}
                      className="w-32 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="text-[0.6875rem] text-[var(--muted-foreground)]">tokens</span>
                  </div>
                </div>
              </div>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Context size controls recent chat messages. Max output reserves completion room; lower it on small local
                contexts if logs show the prompt budget collapsing.
              </p>
            </div>

            {agentAddIntervalMeta && agentAddPreview.runInterval != null && (
              <div className="space-y-1.5">
                <label className="block text-[0.6875rem] font-semibold text-[var(--foreground)]">
                  {agentAddIntervalMeta.label}
                </label>
                <div className="flex items-center gap-3">
                  {agentAddPreview.agent.builtIn ? (
                    <input
                      type="number"
                      min={1}
                      max={agentAddIntervalMeta.max}
                      value={agentAddPreview.runInterval}
                      onChange={(e) => {
                        setAgentAddPreview((current) =>
                          current
                            ? {
                                ...current,
                                runInterval: parseCadenceInputValue(
                                  e.target.value,
                                  agentAddIntervalMeta.defaultValue,
                                  agentAddIntervalMeta.max,
                                ),
                              }
                            : current,
                        );
                      }}
                      disabled={addingAgentToChat}
                      className="w-28 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  ) : (
                    <div className="relative w-28">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          agentAddCadenceInputFocused
                            ? String(agentAddPreview.runInterval)
                            : getCadenceInputValue(agentAddPreview.runInterval)
                        }
                        onFocus={(e) => {
                          setAgentAddCadenceInputFocused(true);
                          e.target.select();
                        }}
                        onBlur={() => setAgentAddCadenceInputFocused(false)}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                          e.preventDefault();
                          const delta = e.key === "ArrowUp" ? 1 : -1;
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  runInterval: stepCadenceValue(
                                    current.runInterval ?? 1,
                                    delta,
                                    agentAddIntervalMeta.max,
                                  ),
                                }
                              : current,
                          );
                        }}
                        onChange={(e) => {
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  runInterval: parseCadenceInputValue(
                                    e.target.value,
                                    current.runInterval ?? 1,
                                    agentAddIntervalMeta.max,
                                  ),
                                }
                              : current,
                          );
                        }}
                        disabled={addingAgentToChat}
                        className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 pr-8 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-md">
                        <button
                          type="button"
                          aria-label="Increase trigger cadence"
                          disabled={addingAgentToChat}
                          onClick={() => {
                            setAgentAddPreview((current) =>
                              current
                                ? {
                                    ...current,
                                    runInterval: stepCadenceValue(
                                      current.runInterval ?? 1,
                                      1,
                                      agentAddIntervalMeta.max,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          className="flex h-4 w-5 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronUp size="0.6875rem" />
                        </button>
                        <button
                          type="button"
                          aria-label="Decrease trigger cadence"
                          disabled={addingAgentToChat}
                          onClick={() => {
                            setAgentAddPreview((current) =>
                              current
                                ? {
                                    ...current,
                                    runInterval: stepCadenceValue(
                                      current.runInterval ?? 1,
                                      -1,
                                      agentAddIntervalMeta.max,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          className="flex h-4 w-5 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronDown size="0.6875rem" />
                        </button>
                      </div>
                    </div>
                  )}
                  <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{agentAddIntervalMeta.unit}</span>
                </div>
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">{agentAddIntervalMeta.help}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setAgentAddPreview(null)}
                disabled={addingAgentToChat}
                className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddAgent}
                disabled={addingAgentToChat}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingAgentToChat ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        )}
      </Modal>

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

function formatMemoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function estimateMemoryTokens(memories: ChatMemoryChunk[]): number {
  const text = memories.map((memory) => memory.content).join("\n\n");
  return Math.ceil(text.length / 4);
}

const MEMORY_CONTENT_CLASS =
  "max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)]/50 px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--foreground)]";

function MemoryRecallMemoriesModal({ chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void }) {
  const memoriesQuery = useChatMemories(chatId, open);
  const deleteMemory = useDeleteChatMemory(chatId);
  const clearMemories = useClearChatMemories(chatId);
  const refreshMemories = useRefreshChatMemories(chatId);
  const memories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const totalTokens = useMemo(() => estimateMemoryTokens(memories), [memories]);

  const handleDelete = async (memory: ChatMemoryChunk) => {
    const ok = await showConfirmDialog({
      title: "Forget Memory",
      message: "Remove this recall memory from this chat?",
      confirmLabel: "Forget",
      tone: "destructive",
    });
    if (ok) deleteMemory.mutate(memory.id);
  };

  const handleClear = async () => {
    if (memories.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear Memories",
      message: "Remove all recall memories for this chat? This does not delete chat messages.",
      confirmLabel: "Clear",
      tone: "destructive",
    });
    if (ok) clearMemories.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title="Memories for This Chat" width="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--secondary)]/70 px-3 py-2 ring-1 ring-[var(--border)]">
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">{memories.length}</span>{" "}
            {memories.length === 1 ? "memory chunk" : "memory chunks"}
            {memories.length > 0 && (
              <>
                {" "}
                · <span className="tabular-nums">~{totalTokens.toLocaleString()} tokens</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => refreshMemories.mutate()}
              disabled={memoriesQuery.isFetching || refreshMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
              title="Rebuild memories from current chat messages"
            >
              <RefreshCw
                size="0.8125rem"
                className={cn((memoriesQuery.isFetching || refreshMemories.isPending) && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={memories.length === 0 || clearMemories.isPending}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
              title="Clear all memories"
            >
              <Trash2 size="0.8125rem" />
            </button>
          </div>
        </div>

        {memoriesQuery.isLoading && (
          <div className="rounded-xl bg-[var(--secondary)]/60 px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            Loading memories...
          </div>
        )}

        {memoriesQuery.error && (
          <div className="rounded-xl bg-[var(--destructive)]/10 px-4 py-3 text-xs text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25">
            Failed to load memories.
          </div>
        )}

        {!memoriesQuery.isLoading && !memoriesQuery.error && memories.length === 0 && (
          <div className="rounded-xl bg-[var(--secondary)]/60 px-4 py-8 text-center text-xs text-[var(--muted-foreground)]">
            No recall memories have been created for this chat yet. Marinara creates them after generation in groups of
            5 messages.
          </div>
        )}

        {memories.length > 0 && (
          <div className="space-y-2">
            {memories.map((memory) => (
              <article key={memory.id} className="rounded-xl bg-[var(--card)] px-3 py-3 ring-1 ring-[var(--border)]">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[0.625rem] text-[var(--muted-foreground)]">
                    <div className="font-medium text-[var(--foreground)]">
                      {formatMemoryDate(memory.firstMessageAt)} - {formatMemoryDate(memory.lastMessageAt)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>{memory.messageCount} messages</span>
                      <span>
                        {memory.hasEmbedding
                          ? "Vectorized"
                          : memory.embeddingStatus === "unavailable"
                            ? "Embedding unavailable"
                            : "Waiting for vector"}
                      </span>
                      <span>Created {formatMemoryDate(memory.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(memory)}
                    disabled={deleteMemory.isPending}
                    className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
                    title="Forget this memory"
                  >
                    <Trash2 size="0.75rem" />
                  </button>
                </div>
                <pre className={MEMORY_CONTENT_CLASS}>{memory.content}</pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Advanced Parameters (per-chat generation overrides) ──
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
  const modeDefaults = isConversation ? CHAT_PARAMETER_DEFAULTS : ROLEPLAY_PARAMETER_DEFAULTS;
  // Use connection-saved defaults if available, otherwise fall back to mode defaults
  const conn = connectionId ? (connections as Record<string, unknown>[]).find((c) => c.id === connectionId) : null;
  const defaults = getEditableGenerationParameters(modeDefaults, conn?.defaultParameters);
  const saveDefaults = useSaveConnectionDefaults();
  const [expanded, setExpanded] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const params = (metadata.chatParameters as Record<string, unknown>) ?? {};
  const customPrompt = (metadata.customSystemPrompt as string) ?? "";
  const effectiveParams = getEditableGenerationParameters(defaults, params);

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

  const setParameters = (next: EditableGenerationParameters) => {
    updateMeta.mutate({ id: chat.id, chatParameters: { ...params, ...next } });
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
          <GenerationParametersFields value={effectiveParams} onChange={setParameters} />
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
                saveDefaults.mutate({
                  id: connectionId,
                  params: effectiveParams as unknown as Record<string, unknown>,
                });
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

// ── Impersonate settings content (rendered inside an Impersonate Section) ──
function ImpersonateSettingsContent({
  presets,
  connections,
}: {
  presets: Array<{ id: string; name: string }>;
  connections: Array<{ id: string; name: string }>;
}) {
  const promptTemplate = useUIStore((s) => s.impersonatePromptTemplate);
  const setPromptTemplate = useUIStore((s) => s.setImpersonatePromptTemplate);
  const showQuickButton = useUIStore((s) => s.impersonateShowQuickButton);
  const setShowQuickButton = useUIStore((s) => s.setImpersonateShowQuickButton);
  const cyoaChoices = useUIStore((s) => s.impersonateCyoaChoices);
  const setCyoaChoices = useUIStore((s) => s.setImpersonateCyoaChoices);
  const presetId = useUIStore((s) => s.impersonatePresetId);
  const setPresetId = useUIStore((s) => s.setImpersonatePresetId);
  const connectionId = useUIStore((s) => s.impersonateConnectionId);
  const setConnectionId = useUIStore((s) => s.setImpersonateConnectionId);
  const blockAgents = useUIStore((s) => s.impersonateBlockAgents);
  const setBlockAgents = useUIStore((s) => s.setImpersonateBlockAgents);
  const hasPromptTemplate = promptTemplate.trim().length > 0;

  const [defaultOpen, setDefaultOpen] = useState(false);

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs font-semibold">Prompt Template</span>
            <HelpTooltip text="Optional global instruction sent to the model when you /impersonate. Leave empty to use the chat-specific prompt, or the built-in default if that chat has none. Macros like {{user}}, {{persona_description}} and {{impersonate_direction}} are replaced before sending." />
          </div>
          <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]/80">
            {hasPromptTemplate ? "Custom" : "Using chat/built-in default"}
          </span>
        </div>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="Empty = use chat/built-in default"
          rows={4}
          className="min-h-20 w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-1.5 font-mono text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setDefaultOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/70 hover:text-[var(--foreground)]"
          >
            {defaultOpen ? <ChevronDown size="0.6875rem" /> : <ChevronRight size="0.6875rem" />}
            Built-in default
          </button>
          {hasPromptTemplate ? (
            <button
              onClick={() => setPromptTemplate("")}
              className="flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Reset to default"
            >
              <RotateCcw size="0.625rem" />
              Reset
            </button>
          ) : (
            <span className="text-[0.625rem] text-[var(--muted-foreground)]/80">Using chat/built-in default</span>
          )}
        </div>
        {defaultOpen && (
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--secondary)]/40 px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
            {DEFAULT_IMPERSONATE_PROMPT}
          </pre>
        )}
      </div>

      <div className="grid gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(7.5rem,1fr)_8.75rem]">
        <label className="order-1 space-y-1 rounded-lg bg-[var(--secondary)]/25 px-3 py-1.5 ring-1 ring-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6875rem] font-semibold">Preset</span>
            <HelpTooltip text="Use a specific prompt preset for roleplay impersonate generations only. Conversation mode does not use prompt presets. Falls back to the chat's preset when set to 'Use chat default'." />
          </div>
          <select
            value={presetId ?? ""}
            onChange={(e) => setPresetId(e.target.value || null)}
            className="w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
          >
            <option value="">Use chat default</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="order-3 space-y-1 rounded-lg bg-[var(--secondary)]/25 px-3 py-1.5 ring-1 ring-[var(--border)] sm:order-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6875rem] font-semibold">Connection</span>
            <HelpTooltip text="Use a specific connection (model/provider) for impersonate generations only. Useful for routing impersonate to a cheaper or faster model." />
          </div>
          <select
            value={connectionId ?? ""}
            onChange={(e) => setConnectionId(e.target.value || null)}
            className="w-full rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
          >
            <option value="">Use chat default</option>
            <option value="random">Random</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="order-2 flex min-h-[2.875rem] min-w-0 items-center justify-between gap-1.5 rounded-lg bg-[var(--secondary)]/25 px-2.5 py-1.5 text-xs font-semibold ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]/40 sm:order-2">
          <span className="min-w-0">Quick button</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <input
              type="checkbox"
              checked={showQuickButton}
              onChange={(e) => setShowQuickButton(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
            />
            <span onClick={(e) => e.preventDefault()}>
              <HelpTooltip text="Show a one-click impersonate button in the chat input toolbar. When pressed with text in the input, it sends that text as the impersonate direction." />
            </span>
          </span>
        </label>

        <label className="order-4 flex min-h-[2.875rem] min-w-0 items-center justify-between gap-1.5 rounded-lg bg-[var(--secondary)]/25 px-2.5 py-1.5 text-xs font-semibold ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]/40">
          <span className="min-w-0">Skip agents</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <input
              type="checkbox"
              checked={blockAgents}
              onChange={(e) => setBlockAgents(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
            />
            <span onClick={(e) => e.preventDefault()}>
              <HelpTooltip text="When enabled, the agent pipeline (trackers, lorebook routers, etc.) is suppressed during impersonate so generations stay fast and don't trigger world-state mutations." />
            </span>
          </span>
        </label>

        <label className="order-5 flex min-h-[2.875rem] min-w-0 items-center justify-between gap-2 rounded-lg bg-[var(--secondary)]/25 px-2.5 py-1.5 text-xs font-semibold ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]/40 sm:col-span-2">
          <span className="min-w-0">Use CYOA as direction</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <input
              type="checkbox"
              checked={cyoaChoices}
              onChange={(e) => setCyoaChoices(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
            />
            <span onClick={(e) => e.preventDefault()}>
              <HelpTooltip text="When enabled, clicking a CYOA option uses it as the direction for an impersonate generation instead of sending the option as a normal user message." />
            </span>
          </span>
        </label>
      </div>
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

// ── Sprite display slider ──
function SpriteRangeSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-[var(--secondary)]/50 px-2.5 py-2 text-[0.625rem] text-[var(--muted-foreground)]">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--foreground)]">{label}</span>
        <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.5625rem] tabular-nums text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full cursor-pointer accent-[var(--primary)]"
      />
    </label>
  );
}

// ── Sprite toggle button (per character) ──
function SpriteToggleButton({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.625rem] font-medium transition-colors ring-1",
        active
          ? "bg-[var(--primary)]/10 text-[var(--primary)] ring-[var(--primary)]/30 hover:bg-[var(--primary)]/15"
          : "text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
        disabled && "opacity-30 cursor-not-allowed",
      )}
      title={active ? "Disable sprite" : disabled ? "Max 3 sprites" : "Enable sprite"}
    >
      <Image size="0.6875rem" />
      <span>{active ? "Enabled" : "Enable"}</span>
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
      idleResponseDelayMinutes?: number;
      dndResponseDelayMinutes?: number;
      talkativeness: number;
    }
  >;
  chatCharIds: string[];
  charNameMap: Map<string, string>;
  onSave: (updated: typeof characterSchedules) => void;
}) {
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    days: Record<string, ScheduleBlock[]>;
    inactivityThresholdMinutes: string;
    idleResponseDelayMinutes: string;
    dndResponseDelayMinutes: string;
  } | null>(null);

  const parseRequiredMinutes = (value: string, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };

  const parseOptionalMinutes = (value: string, min: number, max: number) => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(min, Math.min(max, parsed));
  };

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
      setEditDraft({
        days: JSON.parse(JSON.stringify(schedule.days)),
        inactivityThresholdMinutes: String(schedule.inactivityThresholdMinutes),
        idleResponseDelayMinutes:
          typeof schedule.idleResponseDelayMinutes === "number" ? String(schedule.idleResponseDelayMinutes) : "",
        dndResponseDelayMinutes:
          typeof schedule.dndResponseDelayMinutes === "number" ? String(schedule.dndResponseDelayMinutes) : "",
      });
    }
    setExpandedCharId(charId);
    setExpandedDay(null);
  };

  const handleSave = () => {
    if (!expandedCharId || !editDraft) return;
    const updated = { ...characterSchedules };
    const existingSchedule = updated[expandedCharId]!;
    const nextSchedule = {
      ...existingSchedule,
      days: editDraft.days,
      inactivityThresholdMinutes: parseRequiredMinutes(
        editDraft.inactivityThresholdMinutes,
        existingSchedule.inactivityThresholdMinutes,
        15,
        360,
      ),
    };
    const idleDelay = parseOptionalMinutes(editDraft.idleResponseDelayMinutes, 0, 120);
    const dndDelay = parseOptionalMinutes(editDraft.dndResponseDelayMinutes, 0, 120);
    if (idleDelay === undefined) {
      delete nextSchedule.idleResponseDelayMinutes;
    } else {
      nextSchedule.idleResponseDelayMinutes = idleDelay;
    }
    if (dndDelay === undefined) {
      delete nextSchedule.dndResponseDelayMinutes;
    } else {
      nextSchedule.dndResponseDelayMinutes = dndDelay;
    }
    updated[expandedCharId] = nextSchedule;
    onSave(updated);
    setExpandedCharId(null);
    setEditDraft(null);
  };

  const updateBlock = (day: string, idx: number, field: keyof ScheduleBlock, value: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks[idx] = { ...dayBlocks[idx]!, [field]: value };
    newDraft.days[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const updateDraftSetting = (
    field: "inactivityThresholdMinutes" | "idleResponseDelayMinutes" | "dndResponseDelayMinutes",
    value: string,
  ) => {
    if (!editDraft) return;
    setEditDraft({ ...editDraft, [field]: value });
  };

  const addBlock = (day: string) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks.push({ time: "12:00-13:00", activity: "Free time", status: "online" });
    newDraft.days[day] = dayBlocks;
    setEditDraft(newDraft);
  };

  const removeBlock = (day: string, idx: number) => {
    if (!editDraft) return;
    const newDraft = { ...editDraft, days: { ...editDraft.days } };
    const dayBlocks = [...(newDraft.days[day] ?? [])];
    dayBlocks.splice(idx, 1);
    newDraft.days[day] = dayBlocks;
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
                <div className="rounded-md bg-[var(--background)] p-2 space-y-1.5">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="space-y-1">
                      <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Inactivity
                      </span>
                      <input
                        type="number"
                        min={15}
                        max={360}
                        step={5}
                        value={editDraft.inactivityThresholdMinutes}
                        onChange={(e) => updateDraftSetting("inactivityThresholdMinutes", e.target.value)}
                        className="w-full rounded bg-[var(--secondary)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                        placeholder="120"
                      />
                      <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                        Minutes before they follow up.
                      </span>
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Idle Delay
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        step={0.5}
                        value={editDraft.idleResponseDelayMinutes}
                        onChange={(e) => updateDraftSetting("idleResponseDelayMinutes", e.target.value)}
                        className="w-full rounded bg-[var(--secondary)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                        placeholder="Default"
                      />
                      <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                        Blank keeps the built-in 1-3 minute range.
                      </span>
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[0.55rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        DND Delay
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        step={0.5}
                        value={editDraft.dndResponseDelayMinutes}
                        onChange={(e) => updateDraftSetting("dndResponseDelayMinutes", e.target.value)}
                        className="w-full rounded bg-[var(--secondary)] px-1.5 py-1 text-[0.625rem] outline-none ring-1 ring-transparent focus:ring-[var(--primary)]/40"
                        placeholder="Default"
                      />
                      <span className="block text-[0.5rem] text-[var(--muted-foreground)]">
                        Blank keeps the built-in 2-5 minute range.
                      </span>
                    </label>
                  </div>
                </div>
                {SCHEDULE_DAYS.map((day) => {
                  const blocks = editDraft.days[day] ?? [];
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

function ConversationNotesSection({ chatId }: { chatId: string }) {
  const notesQuery = useChatNotes(chatId);
  const deleteNote = useDeleteChatNote(chatId);
  const clearNotes = useClearChatNotes(chatId);
  const notes = useMemo<ConversationNote[]>(() => notesQuery.data ?? [], [notesQuery.data]);
  const totalChars = useMemo(() => notes.reduce((acc, n) => acc + n.content.length, 0), [notes]);

  const handleDelete = async (note: ConversationNote) => {
    const ok = await showConfirmDialog({
      title: "Delete Note",
      message: "Remove this note from the connected roleplay's prompt?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) deleteNote.mutate(note.id);
  };

  const handleClear = async () => {
    if (notes.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear All Notes",
      message: "Remove every durable note from this roleplay? This cannot be undone.",
      confirmLabel: "Clear all",
      tone: "destructive",
    });
    if (ok) clearNotes.mutate();
  };

  return (
    <Section
      label="Conversation Notes"
      icon={<StickyNote size="0.875rem" />}
      count={notes.length}
      help="Durable notes the connected conversation's character has saved using <note>. They persist in this roleplay's prompt every turn until cleared."
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--muted-foreground)]">
          <span>
            {notesQuery.isLoading
              ? "Loading…"
              : notesQuery.error
                ? "Failed to load."
                : notes.length === 0
                  ? "No notes saved yet."
                  : `${notes.length} ${notes.length === 1 ? "note" : "notes"} · ${totalChars.toLocaleString()} chars`}
          </span>
          {notes.length > 0 && !notesQuery.isLoading && !notesQuery.error && (
            <button
              type="button"
              onClick={handleClear}
              disabled={clearNotes.isPending}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
              title="Clear all notes"
            >
              <Trash2 size="0.75rem" />
            </button>
          )}
        </div>

        {notesQuery.isLoading ? (
          <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-3 text-center text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            Loading notes…
          </p>
        ) : notesQuery.error ? (
          <p className="rounded-lg bg-[var(--destructive)]/10 px-3 py-3 text-[0.625rem] leading-relaxed text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25">
            Failed to load notes.
          </p>
        ) : notes.length === 0 ? (
          <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-3 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            Characters in the connected conversation can save things they want this roleplay to durably remember by
            wrapping text in <code className="rounded bg-[var(--accent)]/60 px-1">{"<note>...</note>"}</code>. Saved
            notes will appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-start gap-2 rounded-lg bg-[var(--card)] px-2.5 py-2 ring-1 ring-[var(--border)]"
              >
                <div className="flex-1 min-w-0">
                  <p className="whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed text-[var(--foreground)]">
                    {note.content}
                  </p>
                  <p className="mt-1 text-[0.5625rem] text-[var(--muted-foreground)]">
                    {formatMemoryDate(note.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(note)}
                  disabled={deleteNote.isPending}
                  className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
                  title="Delete this note"
                >
                  <Trash2 size="0.6875rem" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
