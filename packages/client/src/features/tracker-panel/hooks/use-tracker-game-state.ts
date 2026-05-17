import { useEffect, useState } from "react";
import type { GameState } from "@marinara-engine/shared";
import { api } from "../../../lib/api-client";
import { useGameStateStore } from "../../../stores/game-state.store";

export function useTrackerGameState(activeChatId: string | null) {
  const currentGameState = useGameStateStore((s) =>
    activeChatId && s.current?.chatId === activeChatId ? s.current : null,
  );
  const gameStateRefreshing = useGameStateStore((s) => s.isRefreshing);
  const setGameState = useGameStateStore((s) => s.setGameState);
  const [loadingGameState, setLoadingGameState] = useState(false);

  useEffect(() => {
    if (!activeChatId) {
      setLoadingGameState(false);
      return;
    }

    const existing = useGameStateStore.getState().current;
    if (existing?.chatId === activeChatId) {
      setLoadingGameState(false);
      return;
    }

    let cancelled = false;
    setLoadingGameState(true);
    api
      .get<GameState | null>(`/chats/${activeChatId}/game-state`)
      .then((state) => {
        if (!cancelled) setGameState(state ?? null);
      })
      .catch(() => {
        if (!cancelled) setGameState(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingGameState(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeChatId, setGameState]);

  return {
    currentGameState,
    gameStateRefreshing,
    isLoadingGameState: loadingGameState || gameStateRefreshing,
  };
}
