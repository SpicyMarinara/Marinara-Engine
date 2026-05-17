// ──────────────────────────────────────────────
// Game asset selection helpers
// ──────────────────────────────────────────────

export type GameAssetSelectionStatus = "included" | "partial" | "excluded";

export interface GameAssetSelectionMetadata {
  excludedFolders?: string[];
}

type AssetEntryWithPath = {
  path: string;
};

export function normalizeGameAssetFolderPath(path: string | null | undefined): string {
  return (path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

export function isGameAssetPathInFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeGameAssetFolderPath(path);
  const normalizedFolder = normalizeGameAssetFolderPath(folder);
  if (!normalizedFolder) return true;
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function parseGameAssetExcludedFolders(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const folders = (value as GameAssetSelectionMetadata).excludedFolders;
  if (!Array.isArray(folders)) return [];
  return Array.from(
    new Set(
      folders
        .filter((path): path is string => typeof path === "string")
        .map(normalizeGameAssetFolderPath)
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function serializeGameAssetSelection(excludedFolders: Iterable<string>): GameAssetSelectionMetadata | null {
  const folders = Array.from(
    new Set(Array.from(excludedFolders).map(normalizeGameAssetFolderPath).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  return folders.length > 0 ? { excludedFolders: folders } : null;
}

export function isGameAssetIncluded(path: string, excludedFolders: readonly string[]): boolean {
  return !excludedFolders.some((folder) => folder && isGameAssetPathInFolder(path, folder));
}

export function filterGameAssetMap<T extends AssetEntryWithPath>(
  assets: Record<string, T> | null | undefined,
  excludedFolders: readonly string[],
): Record<string, T> | null {
  if (!assets) return null;
  if (excludedFolders.length === 0) return assets;
  return Object.fromEntries(
    Object.entries(assets).filter(([, entry]) => isGameAssetIncluded(entry.path, excludedFolders)),
  );
}

export function getGameAssetFolderSelectionStatus(
  path: string,
  excludedFolders: readonly string[],
): GameAssetSelectionStatus {
  const folder = normalizeGameAssetFolderPath(path);
  if (!folder) return excludedFolders.length > 0 ? "partial" : "included";
  if (excludedFolders.some((excluded) => isGameAssetPathInFolder(folder, excluded))) {
    return "excluded";
  }
  if (excludedFolders.some((excluded) => isGameAssetPathInFolder(excluded, folder))) {
    return "partial";
  }
  return "included";
}

export function excludeGameAssetFolder(path: string, excludedFolders: readonly string[]): string[] {
  const folder = normalizeGameAssetFolderPath(path);
  if (!folder) return [];
  if (excludedFolders.some((excluded) => isGameAssetPathInFolder(folder, excluded))) {
    return [...excludedFolders];
  }
  return (
    serializeGameAssetSelection([
      ...excludedFolders.filter((excluded) => !isGameAssetPathInFolder(excluded, folder)),
      folder,
    ])?.excludedFolders ?? []
  );
}

export function includeGameAssetFolder(path: string, excludedFolders: readonly string[]): string[] {
  const folder = normalizeGameAssetFolderPath(path);
  if (!folder) return [];
  return (
    serializeGameAssetSelection(
      excludedFolders.filter(
        (excluded) => !isGameAssetPathInFolder(folder, excluded) && !isGameAssetPathInFolder(excluded, folder),
      ),
    )?.excludedFolders ?? []
  );
}
