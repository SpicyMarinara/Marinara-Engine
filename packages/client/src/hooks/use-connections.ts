// ──────────────────────────────────────────────
// React Query: Connection hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { ConnectionTestResult } from "@marinara-engine/shared";

export const connectionKeys = {
  all: ["connections"] as const,
  list: () => [...connectionKeys.all, "list"] as const,
  detail: (id: string) => [...connectionKeys.all, "detail", id] as const,
};

export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: () => api.get<unknown[]>("/connections"),
    staleTime: 5 * 60_000,
  });
}

export function useConnection(id: string | null) {
  return useQuery({
    queryKey: connectionKeys.detail(id ?? ""),
    queryFn: () => api.get<Record<string, unknown>>(`/connections/${id}`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; provider: string; apiKey: string; baseUrl?: string; model?: string }) =>
      api.post("/connections", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) => api.patch(`/connections/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}

export function useDuplicateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKeys.list() }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: string) => api.post<ConnectionTestResult>(`/connections/${id}/test`),
  });
}

export function useTestMessage() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; response: string; latencyMs: number }>(`/connections/${id}/test-message`),
  });
}

export function useTestImageGeneration() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; base64: string | null; mimeType: string | null; latencyMs: number; prompt: string; error?: string }>(
        `/connections/${id}/test-image`,
      ),
  });
}

export function useFetchModels() {
  return useMutation({
    mutationFn: (id: string) => api.get<{ models: Array<{ id: string; name: string }> }>(`/connections/${id}/models`),
  });
}

export function useSaveConnectionDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, params }: { id: string; params: Record<string, unknown> }) =>
      api.put(`/connections/${id}/default-parameters`, params),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() });
      qc.invalidateQueries({ queryKey: connectionKeys.detail(variables.id) });
    },
  });
}
