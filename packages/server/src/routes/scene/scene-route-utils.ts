const SCENE_SUMMARY_DEFAULT_MAX_TOKENS = 1024;

export function resolveSceneSummaryMaxTokens(maxTokensOverride: number | null | undefined): number {
  if (typeof maxTokensOverride !== "number" || !Number.isFinite(maxTokensOverride) || maxTokensOverride <= 0) {
    return SCENE_SUMMARY_DEFAULT_MAX_TOKENS;
  }

  return Math.floor(maxTokensOverride);
}
