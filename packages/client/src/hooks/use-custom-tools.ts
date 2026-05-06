// ──────────────────────────────────────────────
// Hooks: Custom Tools (React Query)
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface CustomToolRow {
  id: string;
  name: string;
  description: string;
  parametersSchema: string;
  executionType: string;
  webhookUrl: string | null;
  staticResult: string | null;
  scriptBody: string | null;
  enabled: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomToolCapabilities {
  scriptExecutionEnabled: boolean;
}

export function isCustomToolSelectable(tool: CustomToolRow, capabilities?: CustomToolCapabilities | null): boolean {
  const enabled = tool.enabled === "true" || tool.enabled === "1";
  if (!enabled) return false;
  return tool.executionType !== "script" || capabilities?.scriptExecutionEnabled === true;
}

const toolKeys = {
  all: ["custom-tools"] as const,
  detail: (id: string) => ["custom-tools", id] as const,
  capabilities: ["custom-tools", "capabilities"] as const,
};

export function useCustomTools() {
  return useQuery({
    queryKey: toolKeys.all,
    queryFn: () => api.get<CustomToolRow[]>("/custom-tools"),
  });
}

export function useCustomTool(id: string | null) {
  return useQuery({
    queryKey: toolKeys.detail(id ?? ""),
    queryFn: () => api.get<CustomToolRow>(`/custom-tools/${id}`),
    enabled: !!id,
  });
}

export function useCustomToolCapabilities() {
  return useQuery({
    queryKey: toolKeys.capabilities,
    queryFn: () => api.get<CustomToolCapabilities>("/custom-tools/capabilities"),
  });
}

export function useCreateCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post("/custom-tools", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

export function useUpdateCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) => api.patch(`/custom-tools/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}

export function useDeleteCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/custom-tools/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: toolKeys.all });
    },
  });
}
