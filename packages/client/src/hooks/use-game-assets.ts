// ──────────────────────────────────────────────
// Hook: Game Assets Browser
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { encodeAssetPath } from "../components/game-assets/encode-asset-path";

/**
 * Single node in the game-assets folder tree.
 */
export interface TreeNode {
  /** File or folder name */
  name: string;
  /** Relative path from game-assets root */
  path: string;
  /** "folder" or "file" */
  type: "folder" | "file";
  /** Child nodes (folders only) */
  children?: TreeNode[];
  /** Lower-case extension including dot (e.g. ".png") */
  ext?: string;
  /** Optional user-edited description */
  description?: string;
  /** File size in bytes */
  size?: number;
  /** ISO 8601 modification timestamp */
  modified?: string;
  /** True if this folder was created by the seed script (bundled default assets) */
  native?: boolean;
}

/** TanStack Query key factory for game-assets queries. */
export const gameAssetKeys = {
  all: ["game-assets"] as const,
  tree: () => [...gameAssetKeys.all, "tree"] as const,
  content: (path: string) => [...gameAssetKeys.all, "content", path] as const,
  info: (path: string) => [...gameAssetKeys.all, "info", path] as const,
};

/**
 * Fetch the full game-assets folder tree.
 * @returns TanStack Query result wrapping the root {@link TreeNode}
 */
export function useGameAssetTree() {
  return useQuery({
    queryKey: gameAssetKeys.tree(),
    queryFn: () => api.get<TreeNode>("/game-assets/tree"),
    staleTime: 0,
  });
}

/**
 * Create a new folder inside game-assets.
 * Invalidates the tree query on success.
 */
export function useCreateGameAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.post("/game-assets/folders", { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Delete an empty folder (or recursively with `recursive: true`).
 * Invalidates the tree query on success.
 */
export function useDeleteGameAssetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, recursive }: { path: string; recursive?: boolean }) =>
      api.delete(`/game-assets/folders/${encodeAssetPath(path)}${recursive ? "?recursive=true" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Rename a file in place.
 * Invalidates the tree query on success.
 */
export function useRenameGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) =>
      api.post("/game-assets/rename", { path, newName }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Move a single file to a different folder.
 * Invalidates the tree query on success.
 */
export function useMoveGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, targetFolder }: { path: string; targetFolder: string }) =>
      api.post("/game-assets/move", { path, targetFolder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Copy a single file to a different folder.
 * Invalidates the tree query on success.
 */
export function useCopyGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, targetFolder }: { path: string; targetFolder: string }) =>
      api.post("/game-assets/copy", { path, targetFolder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Delete a single file.
 * Invalidates the tree query on success.
 */
export function useDeleteGameAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete(`/game-assets/file/${encodeAssetPath(path)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Open the game-assets directory (or a subfolder) in the OS file manager.
 */
export function useOpenGameAssetsFolder() {
  return useMutation({
    mutationFn: (subfolder?: string) => api.post("/game-assets/open-folder", { subfolder }),
  });
}

/**
 * Trigger a server-side rescan of the game-assets directory.
 * Invalidates the tree query on success.
 */
export function useRescanGameAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/game-assets/rescan"),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Upload a file via multipart form-data.
 *
 * `category` and `subcategory` must be appended before `file`
 * in the FormData because the server multipart parser expects
 * them in that order.
 *
 * Invalidates the tree query on success.
 */
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

/**
 * Update the description stored in `meta.json` for a folder.
 * Invalidates the tree query on success.
 */
export function useUpdateFolderDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, description }: { path: string; description: string }) =>
      api.patch("/game-assets/folders/description", { path, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gameAssetKeys.tree() }),
  });
}

/**
 * Fetch the text content of an editable file.
 * @param path - Relative file path
 * @returns TanStack Query result wrapping `{ content: string }`
 */
export function useGameAssetFileContent(path: string) {
  return useQuery({
    queryKey: gameAssetKeys.content(path),
    queryFn: () => api.get<{ content: string }>(`/game-assets/file-content/${encodeAssetPath(path)}`),
    enabled: !!path,
  });
}

/**
 * Save text content back to a file.
 * Invalidates both the content query and the tree query on success.
 */
export function useSaveGameAssetFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put(`/game-assets/file-content/${encodeAssetPath(path)}`, { content }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: gameAssetKeys.content(vars.path) });
      qc.invalidateQueries({ queryKey: gameAssetKeys.tree() });
    },
  });
}

/**
 * Fetch metadata (size, dimensions, format, dates) for a file.
 * @param path - Relative file path
 * @returns TanStack Query result wrapping file info object
 */
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
      }>(`/game-assets/file-info/${encodeAssetPath(path)}`),
    enabled: !!path,
    staleTime: 30000,
  });
}

// ── Bulk operations ──

/**
 * Move multiple files to a target folder in a single request.
 * Returns `{ succeeded, failed, targetFolder }` so the UI can report
 * per-file success or failure.
 * Invalidates the tree query on success.
 */
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

/**
 * Copy multiple files to a target folder in a single request.
 * Returns `{ succeeded, failed, targetFolder }`.
 * Invalidates the tree query on success.
 */
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

/**
 * Delete multiple files in a single request.
 * Returns `{ succeeded, failed }`.
 * Invalidates the tree query on success.
 */
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
