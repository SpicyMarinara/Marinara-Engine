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
}

export const gameAssetKeys = {
  all: ["game-assets"] as const,
  tree: () => [...gameAssetKeys.all, "tree"] as const,
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
