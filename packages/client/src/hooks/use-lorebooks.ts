// ──────────────────────────────────────────────
// React Query: Lorebook hooks
// ──────────────────────────────────────────────
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { Lorebook, LorebookEntry, LorebookFolder } from "@marinara-engine/shared";

export const lorebookKeys = {
  all: ["lorebooks"] as const,
  list: () => [...lorebookKeys.all, "list"] as const,
  byCategory: (cat: string) => [...lorebookKeys.all, "category", cat] as const,
  detail: (id: string) => [...lorebookKeys.all, "detail", id] as const,
  entries: (lorebookId: string) => [...lorebookKeys.all, "entries", lorebookId] as const,
  entry: (entryId: string) => [...lorebookKeys.all, "entry", entryId] as const,
  folders: (lorebookId: string) => [...lorebookKeys.all, "folders", lorebookId] as const,
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
 * data. Returns the flattened entry array plus loading/error state — useful
 * for the Knowledge Router's description-coverage badge.
 *
 * Deduplicates IDs defensively before issuing queries — duplicates can't reach
 * this hook through the current UI, but a duplicate would otherwise register
 * the same query twice and inflate aggregate counts in the consumer.
 *
 * **`entries` is `undefined` until every query has succeeded.** That's a
 * deliberate API choice: returning a partial array on error would silently
 * mislead any consumer that forgot to check `isError`. The type system now
 * forces consumers to handle the unknown case.
 */
export function useEntriesAcrossLorebooks(lorebookIds: string[]): {
  entries: LorebookEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const uniqueIds = Array.from(new Set(lorebookIds));
  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: lorebookKeys.entries(id),
      queryFn: () => api.get<LorebookEntry[]>(`/lorebooks/${id}/entries`),
    })),
  });
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const error = queries.find((q) => q.isError)?.error ?? null;
  // Empty input is trivially "complete" — return [] so consumers can treat
  // "no selection" as a valid known state instead of an unresolved one.
  const allSucceeded = queries.length === 0 || queries.every((q) => q.isSuccess);
  const entries = allSucceeded ? queries.flatMap((q) => q.data ?? []) : undefined;
  return { entries, isLoading, isError, error };
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
    mutationFn: ({
      lorebookId,
      entryIds,
      folderId,
    }: {
      lorebookId: string;
      entryIds: string[];
      /**
       * Container scope for the reorder. `undefined` renumbers every entry
       * (legacy behavior). `null` reorders root-level entries only.
       * A string ID reorders the entries inside that folder only.
       */
      folderId?: string | null;
    }) =>
      api.put<LorebookEntry[]>(`/lorebooks/${lorebookId}/entries/reorder`, {
        entryIds,
        ...(folderId !== undefined ? { folderId } : {}),
      }),
    onSuccess: (entries, variables) => {
      qc.setQueryData(lorebookKeys.entries(variables.lorebookId), entries);
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

// ── Folders ──

export function useLorebookFolders(lorebookId: string | null) {
  return useQuery({
    queryKey: lorebookKeys.folders(lorebookId ?? ""),
    queryFn: () => api.get<LorebookFolder[]>(`/lorebooks/${lorebookId}/folders`),
    enabled: !!lorebookId,
  });
}

export function useCreateLorebookFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, ...data }: { lorebookId: string } & Record<string, unknown>) =>
      api.post<LorebookFolder>(`/lorebooks/${lorebookId}/folders`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.folders(variables.lorebookId) });
    },
  });
}

export function useUpdateLorebookFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      lorebookId,
      folderId,
      ...data
    }: {
      lorebookId: string;
      folderId: string;
    } & Record<string, unknown>) => api.patch<LorebookFolder>(`/lorebooks/${lorebookId}/folders/${folderId}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.folders(variables.lorebookId) });
      // Toggling folder.enabled changes which entries activate during scan
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useDeleteLorebookFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, folderId }: { lorebookId: string; folderId: string }) =>
      api.delete(`/lorebooks/${lorebookId}/folders/${folderId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: lorebookKeys.folders(variables.lorebookId) });
      // Removing a folder reparents its entries to root, so the entry list shape changes.
      qc.invalidateQueries({ queryKey: lorebookKeys.entries(variables.lorebookId) });
      qc.invalidateQueries({ queryKey: [...lorebookKeys.all, "active"] });
    },
  });
}

export function useReorderLorebookFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lorebookId, folderIds }: { lorebookId: string; folderIds: string[] }) =>
      api.put<LorebookFolder[]>(`/lorebooks/${lorebookId}/folders/reorder`, { folderIds }),
    onSuccess: (folders, variables) => {
      qc.setQueryData(lorebookKeys.folders(variables.lorebookId), folders);
      qc.invalidateQueries({ queryKey: lorebookKeys.folders(variables.lorebookId) });
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
