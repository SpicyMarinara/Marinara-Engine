// ──────────────────────────────────────────────
// Hooks: Installed Extensions (server-synced)
// ──────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api-client";
import { useUIStore } from "../stores/ui.store";
import type { CreateExtensionInput, InstalledExtension, UpdateExtensionInput } from "@marinara-engine/shared";

export const extensionKeys = {
  all: ["extensions"] as const,
  list: () => [...extensionKeys.all, "list"] as const,
};

function findDuplicateExtension(extensions: InstalledExtension[], name: string, css: string | null, js: string | null) {
  return (
    extensions.find(
      (ext) => ext.name === name && (ext.css ?? null) === (css ?? null) && (ext.js ?? null) === (js ?? null),
    ) ?? null
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST one extension, backing off on 429 so a long legacy list doesn't dead-end
 * behind the per-IP `/api/extensions` rate limiter (60 req/min).
 */
async function postExtensionWithBackoff(input: CreateExtensionInput): Promise<InstalledExtension> {
  const MAX_ATTEMPTS = 6;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await api.post<InstalledExtension>("/extensions", input);
    } catch (err) {
      lastError = err;
      if (!(err instanceof ApiError) || err.status !== 429) throw err;
      // Exponential backoff capped at the 60s rate-limit window.
      const delay = Math.min(60_000, 2 ** attempt * 1_000);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Extension migration failed after retries");
}

export function useExtensions() {
  return useQuery({
    queryKey: extensionKeys.list(),
    queryFn: () => api.get<InstalledExtension[]>("/extensions"),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: () => (document.hidden ? false : 15_000),
  });
}

export function useCreateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExtensionInput) => api.post<InstalledExtension>("/extensions", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.all });
    },
  });
}

export function useUpdateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateExtensionInput) =>
      api.patch<InstalledExtension>(`/extensions/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.all });
    },
  });
}

export function useDeleteExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/extensions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extensionKeys.all });
    },
  });
}

/**
 * One-shot migration of pre-server-storage extensions out of localStorage.
 *
 * Mirrors `useLegacyThemeMigration`: on first successful list fetch we POST
 * any local-only extensions that don't already exist on the server, then
 * clear the legacy array and flip the migration flag so we don't run again.
 */
export function useLegacyExtensionMigration() {
  const legacyExtensions = useUIStore((s) => s.installedExtensions);
  const hasMigrated = useUIStore((s) => s.hasMigratedExtensionsToServer);
  const clearLegacy = useUIStore((s) => s.clearLegacyExtensions);
  const setMigrated = useUIStore((s) => s.setHasMigratedExtensionsToServer);
  const qc = useQueryClient();
  const inFlightRef = useRef(false);
  const { data: serverExtensions, isSuccess } = useExtensions();

  useEffect(() => {
    if (hasMigrated || !isSuccess || inFlightRef.current) {
      return;
    }
    if (legacyExtensions.length === 0) {
      setMigrated(true);
      return;
    }

    inFlightRef.current = true;
    void (async () => {
      try {
        // Reuse the list React Query already fetched instead of issuing a
        // duplicate GET that would eat into the rate-limit budget.
        let working = [...(serverExtensions ?? [])];

        for (const legacy of legacyExtensions) {
          const css = legacy.css ?? null;
          const js = legacy.js ?? null;
          const duplicate = findDuplicateExtension(working, legacy.name, css, js);
          if (duplicate) continue;

          const created = await postExtensionWithBackoff({
            name: legacy.name,
            description: legacy.description ?? "",
            css,
            js,
            enabled: legacy.enabled,
            installedAt: legacy.installedAt,
          });
          working = [created, ...working];
        }

        clearLegacy();
        setMigrated(true);
        await qc.invalidateQueries({ queryKey: extensionKeys.all });
      } catch (err) {
        // Leave migration flag untouched so the next app start can retry.
        console.warn("[Extensions] Legacy migration failed; will retry on next load.", err);
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [clearLegacy, hasMigrated, isSuccess, legacyExtensions, qc, serverExtensions, setMigrated]);
}
