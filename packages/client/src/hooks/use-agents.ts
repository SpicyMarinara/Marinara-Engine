// ──────────────────────────────────────────────
// Hooks: Agent Configs (React Query)
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export const agentKeys = {
  all: ["agents"] as const,
  detail: (id: string) => ["agents", id] as const,
  customRuns: (chatId: string) => ["agents", "runs", "custom", chatId] as const,
};

export interface AgentConfigRow {
  id: string;
  type: string;
  name: string;
  description: string;
  phase: string;
  enabled: string;
  connectionId: string | null;
  promptTemplate: string;
  settings: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunRow {
  id: string;
  agentConfigId: string;
  agentType: string;
  agentName: string;
  chatId: string;
  messageId: string;
  resultType: string;
  resultData: unknown;
  tokensUsed: number;
  durationMs: number;
  success: boolean;
  error: string | null;
  createdAt: string;
}

export function useAgentConfigs() {
  return useQuery({
    queryKey: agentKeys.all,
    queryFn: () => api.get<AgentConfigRow[]>("/agents"),
    staleTime: 5 * 60_000,
  });
}

export function useAgentConfig(id: string | null) {
  return useQuery({
    queryKey: agentKeys.detail(id ?? ""),
    queryFn: () => api.get<AgentConfigRow>(`/agents/${id}`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useCustomAgentRuns(chatId: string | null, enabled = true) {
  return useQuery({
    queryKey: agentKeys.customRuns(chatId ?? ""),
    queryFn: () => api.get<AgentRunRow[]>(`/agents/runs/${chatId}/custom`),
    enabled: !!chatId && enabled,
    staleTime: 15_000,
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) => api.patch(`/agents/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgentByType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentType, ...data }: { agentType: string } & Record<string, unknown>) =>
      api.patch(`/agents/type/${agentType}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post("/agents", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useUpdateAgentRunData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resultData }: { id: string; chatId: string; resultData: unknown }) =>
      api.patch(`/agents/runs/${id}`, { resultData }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: agentKeys.customRuns(variables.chatId) });
    },
  });
}

export function useToggleAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentType: string) => api.put(`/agents/toggle/${agentType}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
    },
  });
}
