// ──────────────────────────────────────────────
// Hook: Game Mode API
// ──────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { chatKeys } from "./use-chats";
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

interface DiceRollResponse {
  result: DiceRollResult;
}

interface StateTransitionResponse {
  previousState: GameActiveState;
  newState: GameActiveState;
}

interface MapGenerateResponse {
  map: GameMap;
}

interface MapMoveResponse {
  map: GameMap;
}

interface UpdateGameWidgetsResponse {
  ok: boolean;
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
      api.post<SetupResponse>("/game/setup", { ...data, streaming: useUIStore.getState().enableStreaming }),
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
    onSuccess: (res, variables) => {
      store.getState().setActiveGame(variables.gameId, res.sessionChat.id, null);
      store.getState().setSessionNumber(res.sessionNumber);
      qc.setQueryData(chatKeys.detail(res.sessionChat.id), res.sessionChat);
      useChatStore.getState().setActiveChatId(res.sessionChat.id);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: gameKeys.sessions(variables.gameId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(res.sessionChat.id) });
    },
  });
}

export function useConcludeSession() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; connectionId?: string }) =>
      api.post<ConcludeSessionResponse>("/game/session/conclude", data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
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
    mutationFn: (data: { chatId: string; skill: string; dc: number; advantage?: boolean; disadvantage?: boolean }) =>
      api.post<{ result: import("@marinara-engine/shared").SkillCheckResult }>("/game/skill-check", data),
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
      store.getState().setCurrentMap(res.map);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useMoveOnMap() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; position: { x: number; y: number } | string }) =>
      api.post<MapMoveResponse>("/game/map/move", data),
    onSuccess: (res, variables) => {
      store.getState().setCurrentMap(res.map);
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
    if (chatMeta.gameMap && chatMeta.gameMap !== state.currentMap) {
      useGameModeStore.getState().setCurrentMap(chatMeta.gameMap as GameMap);
    }
    if (chatMeta.gameNpcs) {
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
      combatants: Array<Omit<Combatant, "sprite" | "skills" | "mp" | "maxMp">>;
      round: number;
      playerAction?: CombatPlayerAction;
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
