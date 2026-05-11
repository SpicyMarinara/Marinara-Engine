// ──────────────────────────────────────────────
// Hook: Game Assets Browser
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
  ext?: string;
  description?: string;
  size?: number;
  modified?: string;
}

export const gameAssetKeys = {
  all: ["game-assets"] as const,
  tree: () => [...gameAssetKeys.all, "tree"] as const,
  content: (path: string) => [...gameAssetKeys.all, "content", path] as const,
  info: (path: string) => [...gameAssetKeys.all, "info", path] as const,
};

export function useGameAssetTree() {
  return useQuery({
    queryKey: gameAssetKeys.tree(),
    queryFn: () => api.get<TreeNode>("/game-assets/tree"),
    staleTime: 0,
  });
}

export function useCreateGameAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.post("/game-assets/folders", { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useDeleteGameAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, recursive }: { path: string; recursive?: boolean }) =>
      api.delete(`/game-assets/folders/${path}${recursive ? "?recursive=true" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useRenameGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) =>
      api.post("/game-assets/rename", { path, newName }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useMoveGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, targetFolder }: { path: string; targetFolder: string }) =>
      api.post("/game-assets/move", { path, targetFolder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useCopyGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, targetFolder }: { path: string; targetFolder: string }) =>
      api.post("/game-assets/copy", { path, targetFolder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useDeleteGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete(`/game-assets/file/${path}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useOpenGameAssetsFolder() {
  return useMutation({
    mutationFn: (subfolder?: string) => api.post("/game-assets/open-folder", { subfolder }),
  });
}

export function useRescanGameAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/game-assets/rescan"),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useUploadGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, category, subcategory }: { file: File; category: string; subcategory: string }) => {
      const formData = new FormData();
      formData.append("category", category);
      formData.append("subcategory", subcategory);
      formData.append("file", file);
      return api.upload("/game-assets/upload", formData);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useUpdateFolderDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, description }: { path: string; description: string }) =>
      api.patch("/game-assets/folders/description", { path, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useGameAssetFileContent(path: string) {
  return useQuery({
    queryKey: gameAssetKeys.content(path),
    queryFn: () => api.get<{ content: string }>(`/game-assets/file-content/${path}`),
    enabled: !!path,
  });
}

export function useSaveGameAssetFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put(`/game-assets/file-content/${path}`, { content }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: gameAssetKeys.content(vars.path) });
      qc.invalidateQueries({ queryKey: gameAssetKeys.tree() });
    },
  });
}

export function useGameAssetFileInfo(path: string) {
  return useQuery({
    queryKey: gameAssetKeys.info(path),
    queryFn: () =>
      api.get<{
        name: string;
        size: number;
        width?: number;
        height?: number;
        format?: string;
        modified: string;
        created: string;
      }>(`/game-assets/file-info/${path}`),
    enabled: !!path,
    staleTime: 30000,
  });
}

// ── Bulk operations ──

export function useMoveGameAssetsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paths, targetFolder }: { paths: string[]; targetFolder: string }) =>
      api.post<{ succeeded: string[]; failed: { path: string; error: string }[]; targetFolder: string }>(
        "/game-assets/move-bulk",
        { paths, targetFolder },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useCopyGameAssetsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paths, targetFolder }: { paths: string[]; targetFolder: string }) =>
      api.post<{ succeeded: string[]; failed: { path: string; error: string }[]; targetFolder: string }>(
        "/game-assets/copy-bulk",
        { paths, targetFolder },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

export function useDeleteGameAssetsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<{ succeeded: string[]; failed: { path: string; error: string }[] }>("/game-assets/delete-bulk", {
        paths,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}
