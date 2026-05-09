// ──────────────────────────────────────────────
// Hook: Game Mode API
// ──────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isJsonRepairApiError } from "../lib/api-client";
import { chatKeys } from "./use-chats";
import { lorebookKeys } from "./use-lorebooks";
import { useGameModeStore } from "../stores/game-mode.store";
import { useGameStateStore } from "../stores/game-state.store";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import type {
  GameActiveState,
  GameMap,
  GameSetupConfig,
  DiceRollResult,
  SessionSummary,
  Combatant,
  CombatRoundResult,
  CombatPlayerAction,
  HudWidget,
} from "@marinara-engine/shared";
import type { Chat } from "@marinara-engine/shared";

// ── Query Keys ──

export const gameKeys = {
  all: ["game"] as const,
  sessions: (gameId: string) => [...gameKeys.all, "sessions", gameId] as const,
};

// ── Types ──

interface CreateGameResponse {
  sessionChat: Chat;
  gameId: string;
}

interface SetupResponse {
  setup: Record<string, unknown>;
  worldOverview: string | null;
}

interface StartGameResponse {
  status: string;
}

interface StartSessionResponse {
  sessionChat: Chat;
  sessionNumber: number;
  recap: string;
}

interface ConcludeSessionResponse {
  summary: SessionSummary;
}

interface RegenerateSessionConclusionResponse {
  summary: SessionSummary;
}

interface RegenerateSessionLorebookResponse {
  sessionNumber: number;
  lorebookId: string;
  entryCount: number;
}

interface UpdateCampaignProgressionResponse {
  sessionChat: Chat;
  gameId: string;
  campaignProgression: {
    storyArc: string | null;
    plotTwists: string[];
    partyArcs: unknown[];
  };
}

interface RecruitPartyMemberResponse {
  sessionChat: Chat;
  added: boolean;
  characterName: string;
  cardCreated: boolean;
}

interface RegeneratePartyCardResponse {
  sessionChat: Chat;
  characterName: string;
  gameCard: unknown;
}

interface RemovePartyMemberResponse {
  sessionChat: Chat;
  removed: boolean;
  characterName: string;
}

interface DiceRollResponse {
  result: DiceRollResult;
}

interface StateTransitionResponse {
  previousState: GameActiveState;
  newState: GameActiveState;
}

interface MapGenerateResponse {
  map: GameMap;
  maps?: GameMap[];
  activeGameMapId?: string | null;
}

interface MapMoveResponse {
  map: GameMap;
  maps?: GameMap[];
  activeGameMapId?: string | null;
}

interface UpdateGameWidgetsResponse {
  ok: boolean;
}

function patchChatMetadata(chat: Chat | null | undefined, patch: Record<string, unknown>): Chat | null {
  if (!chat) return null;
  const rawMetadata = chat.metadata as unknown;
  const metadata =
    typeof rawMetadata === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(rawMetadata);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {};
          } catch {
            return {};
          }
        })()
      : rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
        ? (rawMetadata as Record<string, unknown>)
        : {};
  return {
    ...chat,
    metadata: {
      ...metadata,
      ...patch,
    } as Chat["metadata"],
  };
}

// ── Mutations ──

export function useCreateGame() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: {
      name: string;
      setupConfig: GameSetupConfig;
      connectionId?: string;
      characterConnectionId?: string;
      promptPresetId?: string;
      chatId?: string;
    }) => api.post<CreateGameResponse>("/game/create", data),
    onSuccess: (res) => {
      store.getState().setActiveGame(res.gameId, res.sessionChat.id, null);
      store.getState().setSetupActive(true);
      // Collapse sidebar when starting a new game to maximize game area
      useUIStore.getState().setSidebarOpen(false);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
    onError: (err) => {
      console.error("[createGame] Error:", err);
    },
  });
}

export function useGameSetup() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; connectionId?: string; preferences: string }) =>
      api.post<SetupResponse>("/game/setup", {
        ...data,
        streaming: useUIStore.getState().enableStreaming,
        debugMode: useUIStore.getState().debugMode,
      }),
    onSuccess: () => {
      store.getState().setSetupActive(false);
      const sessionChatId = store.getState().activeSessionChatId;
      if (sessionChatId) {
        qc.invalidateQueries({ queryKey: chatKeys.detail(sessionChatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionChatId) });
      }
    },
    onError: (err) => {
      console.error("[gameSetup] Error:", err);
      if (isJsonRepairApiError(err)) {
        toast.info("The model response needs a quick JSON repair before it can be applied.", { duration: 8000 });
        return;
      }
      toast.error(err.message || "Game setup failed. Try again or use a different model.", { duration: 10000 });
    },
  });
}

export function useStartGame() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string }) => api.post<StartGameResponse>("/game/start", data),
    onSuccess: () => {
      const sessionChatId = store.getState().activeSessionChatId;
      if (sessionChatId) {
        const queryKey = chatKeys.detail(sessionChatId);
        const patched = patchChatMetadata(qc.getQueryData<Chat>(queryKey), { gameSessionStatus: "active" });
        if (patched) {
          qc.setQueryData(queryKey, patched);
          if (useChatStore.getState().activeChatId === sessionChatId) {
            useChatStore.getState().setActiveChat(patched);
          }
        }
        qc.invalidateQueries({ queryKey: chatKeys.detail(sessionChatId) });
      }
    },
    onError: (err) => {
      console.error("[startGame] Error:", err);
    },
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { gameId: string; connectionId?: string }) =>
      api.post<StartSessionResponse>("/game/session/start", data),
    onMutate: (variables) => {
      toast.loading("Starting the next session and generating recap...", {
        id: `game-session-start:${variables.gameId}`,
      });
    },
    onSuccess: (res, variables) => {
      store.getState().setActiveGame(variables.gameId, res.sessionChat.id, null);
      store.getState().setSessionNumber(res.sessionNumber);
      qc.setQueryData(chatKeys.detail(res.sessionChat.id), res.sessionChat);
      const chatStore = useChatStore.getState();
      chatStore.setActiveChatId(res.sessionChat.id);
      chatStore.setActiveChat(res.sessionChat);
      toast.success(`Session ${res.sessionNumber} is ready.`, {
        id: `game-session-start:${variables.gameId}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: gameKeys.sessions(variables.gameId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(res.sessionChat.id) });
    },
    onError: (err, variables) => {
      console.error("[startSession] Error:", err);
      toast.error(err.message || "Failed to start the next session.", {
        id: `game-session-start:${variables.gameId}`,
      });
    },
  });
}

export function useConcludeSession() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; connectionId?: string; nextSessionRequest?: string }) =>
      api.post<ConcludeSessionResponse>("/game/session/conclude", {
        ...data,
        streaming: useUIStore.getState().enableStreaming,
      }),
    onMutate: (variables) => {
      console.info("[game/session/conclude] Starting conclude request", variables);
      toast.loading("Ending session and generating summary...", {
        id: `game-session-conclude:${variables.chatId}`,
      });
    },
    onSuccess: (_, variables) => {
      console.info("[game/session/conclude] Conclude request completed", variables);
      toast.success("Session concluded.", {
        id: `game-session-conclude:${variables.chatId}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/conclude] Error:", err);
      if (isJsonRepairApiError(err)) {
        toast.info("Review the generated session JSON before applying it.", {
          id: `game-session-conclude:${variables.chatId}`,
          duration: 8000,
        });
        return;
      }
      toast.error(err.message || "Failed to end session.", {
        id: `game-session-conclude:${variables.chatId}`,
      });
    },
  });
}

export function useRegenerateSessionConclusion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; sessionNumber: number; connectionId?: string }) =>
      api.post<RegenerateSessionConclusionResponse>("/game/session/regenerate-conclusion", data),
    onMutate: (variables) => {
      toast.loading(`Regenerating session ${variables.sessionNumber} conclusion...`, {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
    onSuccess: (_, variables) => {
      toast.success(`Session ${variables.sessionNumber} conclusion regenerated.`, {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/regenerate-conclusion] Error:", err);
      if (isJsonRepairApiError(err)) {
        toast.info("Review the regenerated session JSON before applying it.", {
          id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
          duration: 8000,
        });
        return;
      }
      toast.error(err.message || "Failed to regenerate session conclusion.", {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
  });
}

export function useRegenerateSessionLorebook() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; sessionNumber: number; connectionId?: string }) =>
      api.post<RegenerateSessionLorebookResponse>("/game/session/regenerate-lorebook", {
        ...data,
        streaming: useUIStore.getState().enableStreaming,
      }),
    onMutate: (variables) => {
      toast.loading(`Regenerating session ${variables.sessionNumber} lorebook...`, {
        id: `game-session-lorebook:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
    onSuccess: (result, variables) => {
      toast.success(`Lorebook updated with ${result.entryCount} entr${result.entryCount === 1 ? "y" : "ies"}.`, {
        id: `game-session-lorebook:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: lorebookKeys.all });
      if (result.lorebookId) {
        qc.invalidateQueries({ queryKey: lorebookKeys.entries(result.lorebookId) });
      }
    },
    onError: (err, variables) => {
      console.error("[game/session/regenerate-lorebook] Error:", err);
      toast.error(err.message || "Failed to regenerate session lorebook.", {
        id: `game-session-lorebook:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useUpdateCampaignProgression() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; sessionNumber: number; connectionId?: string }) =>
      api.post<UpdateCampaignProgressionResponse>("/game/session/update-campaign-progression", data),
    onMutate: (variables) => {
      toast.loading(`Updating plot arcs from session ${variables.sessionNumber}...`, {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(res.sessionChat.id), res.sessionChat);
      toast.success(`Plot arcs updated from session ${variables.sessionNumber}.`, {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(res.sessionChat.id) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: gameKeys.sessions(res.gameId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/update-campaign-progression] Error:", err);
      if (isJsonRepairApiError(err)) {
        toast.info("Review the generated plot JSON before applying it.", {
          id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
          duration: 8000,
        });
        return;
      }
      toast.error(err.message || "Failed to update plot arcs.", {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
  });
}

export function useRecruitPartyMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; characterName: string; connectionId?: string }) =>
      api.post<RecruitPartyMemberResponse>("/game/party/recruit", data),
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(variables.chatId), res.sessionChat);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      if (res.added) {
        toast.success(`${res.characterName} joined the party.`);
      } else if (res.cardCreated) {
        toast.success(`${res.characterName}'s party card was created.`);
      }
    },
    onError: (err) => {
      console.error("[recruitPartyMember] Error:", err);
      toast.error(err.message || "Failed to recruit party member.");
    },
  });
}

export function useRegeneratePartyCard() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; characterName: string; characterId?: string; connectionId?: string }) =>
      api.post<RegeneratePartyCardResponse>("/game/party/card/regenerate", data),
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(variables.chatId), res.sessionChat);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      toast.success(`${res.characterName}'s sheet was regenerated.`);
    },
    onError: (err) => {
      console.error("[regeneratePartyCard] Error:", err);
      toast.error(err.message || "Failed to regenerate party sheet.");
    },
  });
}

export function useRemovePartyMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; characterName: string }) =>
      api.post<RemovePartyMemberResponse>("/game/party/remove", data),
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(variables.chatId), res.sessionChat);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      if (res.removed) {
        toast.success(`${res.characterName} left the party.`);
      }
    },
    onError: (err) => {
      console.error("[removePartyMember] Error:", err);
      toast.error(err.message || "Failed to remove party member.");
    },
  });
}

export function useRollDice() {
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; notation: string; context?: string }) =>
      api.post<DiceRollResponse>("/game/dice/roll", data),
    onSuccess: (res) => {
      store.getState().setDiceRollResult(res.result);
    },
  });
}

export function useSkillCheck() {
  return useMutation({
    mutationFn: (data: {
      chatId: string;
      skill: string;
      dc: number;
      advantage?: boolean;
      disadvantage?: boolean;
      preRolledD20?: number;
    }) => api.post<{ result: import("@marinara-engine/shared").SkillCheckResult }>("/game/skill-check", data),
  });
}

export function useTransitionGameState() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; newState: GameActiveState }) =>
      api.post<StateTransitionResponse>("/game/state/transition", data),
    onSuccess: (res, variables) => {
      store.getState().setGameState(res.newState);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useGenerateMap() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; locationType: string; context: string; connectionId?: string }) =>
      api.post<MapGenerateResponse>("/game/map/generate", data),
    onSuccess: (res, variables) => {
      if (res.maps?.length) {
        store.getState().setMaps(res.maps, res.activeGameMapId);
      } else {
        store.getState().setCurrentMap(res.map);
      }
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useMoveOnMap() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; position: { x: number; y: number } | string; mapId?: string | null }) =>
      api.post<MapMoveResponse>("/game/map/move", data),
    onSuccess: (res, variables) => {
      if (res.maps?.length) {
        store.getState().setMaps(res.maps, res.activeGameMapId);
      } else {
        store.getState().setCurrentMap(res.map);
      }
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useUpdateGameWidgets() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ chatId, widgets }: { chatId: string; widgets: HudWidget[] }) =>
      api.put<UpdateGameWidgetsResponse>(`/game/${chatId}/widgets`, { widgets }),
    onSuccess: (_, variables) => {
      useGameModeStore.getState().setHudWidgets(variables.widgets);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
    onError: (err) => {
      console.error("[updateGameWidgets] Error:", err);
    },
  });
}

// ── Queries ──

export function useGameSessions(gameId: string | null) {
  return useQuery({
    queryKey: gameKeys.sessions(gameId ?? ""),
    queryFn: () => api.get<Chat[]>(`/game/${gameId}/sessions`),
    enabled: !!gameId,
    staleTime: 2 * 60_000,
  });
}

// ── Sync hook — reads chat metadata and updates game store ──

export function useSyncGameState(activeChatId: string, chatMeta: Record<string, unknown>) {
  const prevChatIdRef = useRef<string | null>(null);

  // Reset game store only when the active chat changes, not on every metadata refetch
  useEffect(() => {
    if (prevChatIdRef.current && prevChatIdRef.current !== activeChatId) {
      useGameModeStore.getState().reset();
    }
    prevChatIdRef.current = activeChatId;
    return () => {
      useGameModeStore.getState().reset();
    };
  }, [activeChatId]);

  // Sync metadata into the game store
  useEffect(() => {
    if (!chatMeta.gameId) return;
    const state = useGameModeStore.getState();

    if (chatMeta.gameId !== state.activeGameId) {
      useGameModeStore
        .getState()
        .setActiveGame(chatMeta.gameId as string, activeChatId, chatMeta.gamePartyChatId as string | undefined);
      // Auto-collapse the chat sidebar when entering a game to maximize game area
      useUIStore.getState().setSidebarOpen(false);
    }
    if (chatMeta.gameActiveState && chatMeta.gameActiveState !== state.gameState) {
      useGameModeStore.getState().setGameState(chatMeta.gameActiveState as GameActiveState);
    }
    const metadataMaps = Array.isArray(chatMeta.gameMaps) ? (chatMeta.gameMaps as GameMap[]) : [];
    const activeMapId = typeof chatMeta.activeGameMapId === "string" ? chatMeta.activeGameMapId : null;
    if (metadataMaps.length > 0) {
      useGameModeStore.getState().setMaps(metadataMaps, activeMapId);
    } else if (chatMeta.gameMap && chatMeta.gameMap !== state.currentMap) {
      useGameModeStore.getState().setCurrentMap(chatMeta.gameMap as GameMap);
    }
    if (Array.isArray(chatMeta.gameNpcs)) {
      useGameModeStore.getState().setNpcs(chatMeta.gameNpcs as any[]);
    }
    if (chatMeta.gameSessionNumber) {
      useGameModeStore.getState().setSessionNumber(chatMeta.gameSessionNumber as number);
    }
    if (chatMeta.gameSessionStatus === "setup") {
      useGameModeStore.getState().setSetupActive(true);
    }
    // Load blueprint + HUD widgets (only if store doesn't already have them)
    if (chatMeta.gameBlueprint && !state.blueprint) {
      const bp = chatMeta.gameBlueprint as import("@marinara-engine/shared").GameBlueprint;
      useGameModeStore.getState().setBlueprint(bp);
      if (bp.hudWidgets?.length) {
        // Normalize: GM may produce "items" instead of "contents" for inventory_grid,
        // and older blueprints used {name, slot: number} instead of {name, slot?: string, quantity}.
        const normalized = bp.hudWidgets.map((w) => {
          if (w.type === "inventory_grid" && !w.config.contents && Array.isArray((w.config as any).items)) {
            const items = (w.config as any).items as Array<{ name: string; slot?: string | number; quantity?: number }>;
            return {
              ...w,
              config: {
                ...w.config,
                contents: items.map((i) => ({
                  name: i.name,
                  slot: typeof i.slot === "string" ? i.slot : undefined,
                  quantity: i.quantity ?? 1,
                })),
              },
            };
          }
          return w;
        });
        useGameModeStore.getState().setHudWidgets(normalized);
      }
    }
    // Load persisted widget state (overrides blueprint defaults)
    if (chatMeta.gameWidgetState && Array.isArray(chatMeta.gameWidgetState)) {
      const persisted = chatMeta.gameWidgetState as import("@marinara-engine/shared").HudWidget[];
      if (persisted.length > 0) {
        useGameModeStore.getState().setHudWidgets(persisted);
      }
    }
  }, [activeChatId, chatMeta]);
}

// ── New Game Mechanics Hooks ──

export function useCombatRound() {
  return useMutation({
    mutationFn: (data: {
      chatId: string;
      combatants: Array<Omit<Combatant, "sprite">>;
      round: number;
      playerAction?: CombatPlayerAction;
      mechanics?: import("@marinara-engine/shared").CombatMechanic[];
    }) => api.post<{ result: CombatRoundResult; combatants: Combatant[] }>("/game/combat/round", data),
  });
}

export function useCombatLoot() {
  return useMutation({
    mutationFn: async (data: { chatId: string; enemyCount: number }) => {
      const res = await api.post<{
        drops: Array<{ item?: { name?: string | null } | null; quantity?: number | null } | null>;
      }>("/game/combat/loot", data);

      return {
        drops: (res.drops ?? [])
          .filter((drop): drop is NonNullable<(typeof res.drops)[number]> => !!drop?.item?.name)
          .map((drop) => ({ name: drop.item!.name!, quantity: drop.quantity ?? undefined })),
      };
    },
  });
}

export function useLootGenerate() {
  return useMutation({
    mutationFn: (data: { chatId: string; count?: number }) =>
      api.post<{ drops: unknown[] }>("/game/loot/generate", data),
  });
}

export function useAdvanceTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; action: string }) =>
      api.post<{ time: unknown; formatted: string }>("/game/time/advance", data),
    onSuccess: (res, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      // Sync time into the game state snapshot so WeatherEffects updates immediately
      if (res.formatted) {
        const current = useGameStateStore.getState().current;
        if (current) {
          useGameStateStore.getState().setGameState({
            ...current,
            time: res.formatted,
          });
        }
      }
    },
  });
}

export function useUpdateWeather() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; action: string; location?: string; season?: string; type?: string }) =>
      api.post<{ changed: boolean; weather: { type: string; temperature: number } }>("/game/weather/update", data),
    onSuccess: (res, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      // Sync weather into the game state snapshot store so WeatherEffects updates immediately
      if (res.changed && res.weather) {
        const current = useGameStateStore.getState().current;
        if (current) {
          useGameStateStore.getState().setGameState({
            ...current,
            weather: res.weather.type,
            temperature: `${res.weather.temperature}°C`,
          });
        }
      }
    },
  });
}

export function useRollEncounter() {
  return useMutation({
    mutationFn: (data: { chatId: string; action: string; location?: string }) =>
      api.post<{ encounter: { triggered: boolean; type: string | null; hint: string }; enemyCount: number }>(
        "/game/encounter/roll",
        data,
      ),
  });
}

export function useUpdateReputation() {
  const qc = useQueryClient();
  const store = useGameModeStore;
  return useMutation({
    mutationFn: (data: { chatId: string; actions: Array<{ npcId: string; action: string; modifier?: number }> }) =>
      api.post<{ npcs: unknown[]; changes: unknown[] }>("/game/reputation/update", data),
    onSuccess: (res, variables) => {
      store.getState().setNpcs(res.npcs as any[]);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; type: string; data: Record<string, unknown> }) =>
      api.post<{ journal: unknown }>("/game/journal/entry", data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useGameJournal(chatId: string | null) {
  return useQuery({
    queryKey: [...gameKeys.all, "journal", chatId],
    queryFn: () => api.get<{ journal: unknown; recap: string }>(`/game/${chatId}/journal`),
    enabled: !!chatId,
    staleTime: 30_000,
  });
}

// ── Checkpoints ──

export function useGameCheckpoints(chatId: string | null) {
  return useQuery({
    queryKey: [...gameKeys.all, "checkpoints", chatId],
    queryFn: () => api.get<import("@marinara-engine/shared").GameCheckpoint[]>(`/game/${chatId}/checkpoints`),
    enabled: !!chatId,
    staleTime: 30_000,
  });
}

export function useCreateCheckpoint() {
  return useMutation({
    mutationFn: (data: { chatId: string; label: string; triggerType: string }) =>
      api.post<{ id: string }>("/game/checkpoint", data),
  });
}

export function useLoadCheckpoint() {
  return useMutation({
    mutationFn: (data: { chatId: string; checkpointId: string }) =>
      api.post<{ ok: boolean; messageId: string }>("/game/checkpoint/load", data),
  });
}

export function useDeleteCheckpoint() {
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/game/checkpoint/${id}`),
  });
}
