type FullBodySpriteLike = {
  expression: string;
};

function normalizePoseToken(value?: string | null): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") ?? ""
  );
}

function listAvailableFullBodyPoses(sprites?: readonly FullBodySpriteLike[] | null): Set<string> {
  const poses = new Set<string>();
  for (const sprite of sprites ?? []) {
    const normalized = normalizePoseToken(sprite.expression);
    if (!normalized.startsWith("full_")) continue;
    const pose = normalized.slice(5);
    if (pose) poses.add(pose);
  }
  return poses;
}

function pickFirstAvailable(
  availablePoses: Set<string>,
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizePoseToken(candidate);
    if (normalized && availablePoses.has(normalized)) return normalized;
  }
  if (availablePoses.has("idle")) return "idle";
  if (availablePoses.has("battle_stance")) return "battle_stance";
  const first = availablePoses.values().next();
  return first.done ? undefined : first.value;
}

export function resolveDialogueFullBodyPose(
  expression?: string | null,
  sprites?: readonly FullBodySpriteLike[] | null,
): string | undefined {
  const availablePoses = listAvailableFullBodyPoses(sprites);
  if (availablePoses.size === 0) return undefined;

  const normalizedExpression = normalizePoseToken(expression);
  if (normalizedExpression === "thinking") {
    return pickFirstAvailable(availablePoses, "thinking", "idle");
  }
  if (normalizedExpression === "laughing") {
    return pickFirstAvailable(availablePoses, "cheer", "idle");
  }

  return pickFirstAvailable(availablePoses, normalizedExpression, "idle");
}

export function resolveCombatFullBodyPose(
  suggestedPose?: string | null,
  sprites?: readonly FullBodySpriteLike[] | null,
): string | undefined {
  const availablePoses = listAvailableFullBodyPoses(sprites);
  if (availablePoses.size === 0) return undefined;

  const normalizedPose = normalizePoseToken(suggestedPose);
  switch (normalizedPose) {
    case "attack":
      return pickFirstAvailable(availablePoses, "attack", "battle_stance", "idle");
    case "defend":
      return pickFirstAvailable(availablePoses, "defend", "battle_stance", "idle");
    case "casting":
      return pickFirstAvailable(availablePoses, "casting", "battle_stance", "idle");
    case "hurt":
      return pickFirstAvailable(availablePoses, "hurt", "battle_stance", "idle");
    case "victory":
      return pickFirstAvailable(availablePoses, "victory", "cheer", "battle_stance", "idle");
    default:
      return pickFirstAvailable(availablePoses, normalizedPose, "battle_stance", "idle");
  }
}
