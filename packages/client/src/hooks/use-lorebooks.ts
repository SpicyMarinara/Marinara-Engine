// ──────────────────────────────────────────────
// React Query: Lorebook hooks
// ──────────────────────────────────────────────
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { Lorebook, LorebookEntry } from "@marinara-engine/shared";

export const lorebookKeys = {
  all: ["lorebooks"] as const,
  list: () => [...lorebookKeys.all, "list"] as const,
  byCategory: (cat: string) => [...lorebookKeys.all, "category", cat] as const,
  detail: (id: string) => [...lorebookKeys.all, "detail", id] as const,
  entries: (lorebookId: string) => [...lorebookKeys.all, "entries", lorebookId] as const,
  entry: (entryId: string) => [...lorebookKeys.all, "entry", entryId] as const,
  search: (q: string) => [...lorebookKeys.all, "search", q] as const,
};

// ── Lorebooks ──

export function useLorebooks(category?: string) {
  return useQuery({
    queryKey: category ? lorebookKeys.byCategory(category) : lorebookKeys.list(),
    queryFn: () => api.get<Lorebook[]>(category ? `/lorebooks?category=${category}` : "/lorebooks"),
    staleTime: 5 * 60_000,
  });
}

export function useLorebook(id: string | null) {
  return useQuery({
    queryKey: lorebookKeys.detail(id ?? ""),
    queryFn: () => api.get<Lorebook>(`/lorebooks/${id}`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useCreateLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<Lorebook>("/lorebooks", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lorebookKeys.all });
    },
  });
}

export function useUpdateLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch<Lorebook>(`/lorebooks/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.list() });
      qc.invalidateQueries({ queryKey: lorebookKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useDeleteLorebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/lorebooks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lorebookKeys.all });
    },
  });
}

// ── Entries ──

export function useLorebookEntries(lorebookId: string | null) {
  return useQuery({
    queryKey: lorebookKeys.entries(lorebookId ?? ""),
    queryFn: () => api.get<LorebookEntry[]>(`/lorebooks/${lorebookId}/entries`),
    enabled: !!lorebookId,
  });
}

/**
 * Fetch entries across multiple lorebooks in parallel. Each per-lorebook query
 * is cached independently, so repeated calls with overlapping IDs reuse cached
 * data. Returns the flattened entry array plus loading state — useful for the
 * Knowledge Router's description-coverage badge.
 *
 * Deduplicates IDs defensively before issuing queries — duplicates can't reach
 * this hook through the current UI, but a duplicate would otherwise register
 * the same query twice and inflate aggregate counts in the consumer.
 */
export function useEntriesAcrossLorebooks(lorebookIds: string[]) {
  const uniqueIds = Array.from(new Set(lorebookIds));
  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: lorebookKeys.entries(id),
      queryFn: () => api.get<LorebookEntry[]>(`/lorebooks/${id}/entries`),
    })),
  });
  const isLoading = queries.some((q) => q.isLoading);
  const entries = queries.flatMap((q) => q.data ?? []);
  return { entries, isLoading };
}

export function useLorebookEntry(lorebookId: string | null, entryId: string | null) {
  return useQuery({
    queryKey: lorebookKeys.entry(entryId ?? ""),
    queryFn: () => api.get<LorebookEntry>(`/lorebooks/${lorebookId}/entries/${entryId}`),
    enabled: !!lorebookId && !!entryId,
  });
}

export function useCreateLorebookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, ...data }: { lorebookId: string } & Record<string, unknown>) =>
      api.post<LorebookEntry>(`/lorebooks/${lorebookId}/entries`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useUpdateLorebookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, entryId, ...data }: { lorebookId: string; entryId: string } & Record<string, unknown>) =>
      api.patch<LorebookEntry>(`/lorebooks/${lorebookId}/entries/${entryId}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: lorebookKeys.entry(variables.entryId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useDeleteLorebookEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, entryId }: { lorebookId: string; entryId: string }) =>
      api.delete(`/lorebooks/${lorebookId}/entries/${entryId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useBulkCreateEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, entries }: { lorebookId: string; entries: unknown[] }) =>
      api.post<LorebookEntry[]>(`/lorebooks/${lorebookId}/entries/bulk`, { entries }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useReorderLorebookEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, entryIds }: { lorebookId: string; entryIds: string[] }) =>
      api.put<LorebookEntry[]>(`/lorebooks/${lorebookId}/entries/reorder`, { entryIds }),
    onSuccess: (entries, variables) => {
      qc.setQueryData(lorebookKeys.entries(variables.lorebookId), entries);
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useSearchLorebookEntries(query: string) {
  return useQuery({
    queryKey: lorebookKeys.search(query),
    queryFn: () => api.get<LorebookEntry[]>(`/lorebooks/search/entries?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });
}

export interface ActiveLorebookEntry {
  id: string;
  name: string;
  content: string;
  keys: string[];
  lorebookId: string;
  order: number;
  constant: boolean;
}

export interface ActiveLorebookScan {
  entries: ActiveLorebookEntry[];
  totalTokens: number;
  totalEntries: number;
}

export function useActiveLorebookEntries(chatId: string | null, enabled = false) {
  return useQuery({
    queryKey: [...lorebookKeys.all, "active", chatId] as const,
    queryFn: () => api.get<ActiveLorebookScan>(`/lorebooks/scan/${chatId}`),
    enabled: !!chatId && enabled,
    staleTime: 30_000,
  });
}
