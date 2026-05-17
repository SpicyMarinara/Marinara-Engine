import { resolveAssetTag } from "../../lib/asset-fuzzy-match";

type AssetManifestMap = Record<string, { path: string }> | null;

export type SceneAssetNpcAvatarCandidate = {
  name: string;
  description: string;
  avatarUrl?: string | null;
};

type MissingSceneAssetGenerationPayload = {
  chatId: string;
  backgroundTag?: string;
  npcsNeedingAvatars?: Array<{ name: string; description: string }>;
  forceNpcAvatarNames?: string[];
};

type MissingSceneAssetGenerationInput = {
  gameImageGenerationEnabled: boolean;
  activeChatId: string | null;
  currentBackground: string | null;
  savedSceneBackground: string | undefined;
  assetMap: AssetManifestMap;
  sceneAssetNpcs: SceneAssetNpcAvatarCandidate[];
  npcAvatarLookup: Map<string, string>;
  npcsNeedingAvatars: Array<{ name: string; description: string }>;
  failedNpcAvatarNames?: Iterable<string>;
};

export function normalizeSceneAssetNameForGeneration(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function getMissingBackgroundTag(
  backgroundTag: string | undefined | null,
  manifest: AssetManifestMap,
): string | null {
  const cleaned = backgroundTag?.trim();
  if (!cleaned || cleaned === "black" || cleaned === "none") return null;
  const resolved = resolveAssetTag(cleaned, "backgrounds", manifest);
  return manifest?.[resolved] ? null : cleaned;
}

export function buildMissingSceneAssetGenerationPayload({
  gameImageGenerationEnabled,
  activeChatId,
  currentBackground,
  savedSceneBackground,
  assetMap,
  sceneAssetNpcs,
  npcAvatarLookup,
  npcsNeedingAvatars,
  failedNpcAvatarNames,
}: MissingSceneAssetGenerationInput): MissingSceneAssetGenerationPayload | null {
  if (!gameImageGenerationEnabled) return null;
  if (!activeChatId) return null;

  const unresolvedBackground = getMissingBackgroundTag(currentBackground || savedSceneBackground, assetMap);
  const savedGeneratedBackgroundMissing =
    !!savedSceneBackground &&
    unresolvedBackground === savedSceneBackground &&
    savedSceneBackground.startsWith("backgrounds:");
  const npcAssetCandidates = sceneAssetNpcs
    .filter((npc) => npc.description && npc.name)
    .map((npc) => ({ name: npc.name, description: npc.description }))
    .slice(0, 10);
  const forceNpcAvatarNameSet = new Set<string>();
  if (savedGeneratedBackgroundMissing) {
    for (const npc of npcAssetCandidates) {
      if (npcAvatarLookup.has(normalizeSceneAssetNameForGeneration(npc.name))) {
        forceNpcAvatarNameSet.add(npc.name);
      }
    }
  }
  const failedNpcAvatarNameSet = new Set(
    [...(failedNpcAvatarNames ?? [])].map(normalizeSceneAssetNameForGeneration).filter(Boolean),
  );
  for (const npc of npcAssetCandidates) {
    if (failedNpcAvatarNameSet.has(normalizeSceneAssetNameForGeneration(npc.name))) {
      forceNpcAvatarNameSet.add(npc.name);
    }
  }
  const forceNpcAvatarNames = [...forceNpcAvatarNameSet];
  const forcedNpcPayload = npcAssetCandidates.filter((npc) => forceNpcAvatarNameSet.has(npc.name));
  const npcPayload =
    savedGeneratedBackgroundMissing && forceNpcAvatarNames.length > 0
      ? npcAssetCandidates
      : [
          ...npcsNeedingAvatars,
          ...forcedNpcPayload.filter(
            (forcedNpc) =>
              !npcsNeedingAvatars.some(
                (npc) =>
                  normalizeSceneAssetNameForGeneration(npc.name) ===
                  normalizeSceneAssetNameForGeneration(forcedNpc.name),
              ),
          ),
        ].slice(0, 10);

  if (!unresolvedBackground && npcPayload.length === 0) return null;

  return {
    chatId: activeChatId,
    backgroundTag: unresolvedBackground ?? undefined,
    npcsNeedingAvatars: npcPayload.length > 0 ? npcPayload : undefined,
    forceNpcAvatarNames: forceNpcAvatarNames.length > 0 ? forceNpcAvatarNames : undefined,
  };
}
