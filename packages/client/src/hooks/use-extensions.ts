// ──────────────────────────────────────────────
// Hooks: Installed Extensions (server-synced)
// ──────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
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

export function useExtensions() {
  return useQuery({
    queryKey: extensionKeys.list(),
    queryFn: () => api.get<InstalledExtension[]>("/extensions"),
    staleTime: 0,
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
  const { isSuccess } = useExtensions();

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
        const serverExtensions = await api.get<InstalledExtension[]>("/extensions");
        let working = [...serverExtensions];

        for (const legacy of legacyExtensions) {
          const css = legacy.css ?? null;
          const js = legacy.js ?? null;
          const duplicate = findDuplicateExtension(working, legacy.name, css, js);
          if (duplicate) continue;

          const created = await api.post<InstalledExtension>("/extensions", {
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
      } catch {
        // Leave migration flag untouched so the next app start can retry.
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [clearLegacy, hasMigrated, isSuccess, legacyExtensions, qc, setMigrated]);
}
