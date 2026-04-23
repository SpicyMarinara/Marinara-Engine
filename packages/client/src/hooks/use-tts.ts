// ──────────────────────────────────────────────
// Hook: TTS Config & Voices
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { TTSConfig, TTSVoicesResponse } from "@marinara-engine/shared";
import { TTS_API_KEY_MASK } from "@marinara-engine/shared";

const KEYS = {
  config: ["tts", "config"] as const,
  voices: (baseUrl: string) => ["tts", "voices", baseUrl] as const,
};

// ── Config ───────────────────────────────────────

export function useTTSConfig() {
  return useQuery({
    queryKey: KEYS.config,
    queryFn: () => api.get<TTSConfig>("/tts/config"),
    staleTime: 60_000,
  });
}

export function useUpdateTTSConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: TTSConfig) => api.put<void>("/tts/config", config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.config });
      qc.invalidateQueries({ queryKey: ["tts", "voices"] });
    },
  });
}

// ── Voices ───────────────────────────────────────

export function useTTSVoices(baseUrl: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.voices(baseUrl),
    queryFn: () => api.get<TTSVoicesResponse>("/tts/voices"),
    enabled: enabled && Boolean(baseUrl),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

// ── Speak (fire-and-forget mutation used by tts-service) ─────────────────

export { TTS_API_KEY_MASK };
