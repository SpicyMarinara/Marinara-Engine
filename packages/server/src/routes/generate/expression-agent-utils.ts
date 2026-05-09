export type AvailableSpriteCharacter = {
  characterId: string;
  characterName: string;
  expressions: string[];
  expressionChoices?: string[];
};

export type SpriteExpressionEntry = {
  characterId?: unknown;
  characterName?: unknown;
  expression?: unknown;
  transition?: unknown;
};

export type ExpressionValidationWarning = {
  message: string;
};

export type ExpressionValidationResult<T extends SpriteExpressionEntry> = {
  expressions: T[];
  warnings: ExpressionValidationWarning[];
};

function normalizeLookupToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeNameAliases(name: string): string[] {
  const aliases = new Set<string>();
  const normalized = normalizeLookupToken(name);
  if (normalized) aliases.add(normalized);

  const withoutCommonTitle = name.replace(/^\s*(il|la|le|the)\s+/i, "");
  const normalizedWithoutTitle = normalizeLookupToken(withoutCommonTitle);
  if (normalizedWithoutTitle) aliases.add(normalizedWithoutTitle);

  return [...aliases];
}

function normalizeExpressionToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function hasUsefulContainmentMatch(candidate: string, option: string): boolean {
  if (candidate.length < 3 || option.length < 3) return false;
  return candidate.includes(option) || option.includes(candidate);
}

function pickRandomExpression(expressions: string[]): string | null {
  if (expressions.length === 0) return null;
  return expressions[Math.floor(Math.random() * expressions.length)] ?? expressions[0] ?? null;
}

function getExpressionPrefixVariant(expression: string, groupKey: string): boolean {
  const lower = expression.toLowerCase();
  const normalizedGroup = groupKey.trim().toLowerCase();
  return lower.startsWith(`${normalizedGroup}_`);
}

function resolveCharacter(
  entry: SpriteExpressionEntry,
  availableSprites: AvailableSpriteCharacter[],
): AvailableSpriteCharacter | null {
  const rawId = typeof entry.characterId === "string" ? entry.characterId.trim() : "";
  if (rawId) {
    const exactId = availableSprites.find((sprite) => sprite.characterId === rawId);
    if (exactId) return exactId;

    const caseInsensitiveId = availableSprites.find(
      (sprite) => sprite.characterId.toLowerCase() === rawId.toLowerCase(),
    );
    if (caseInsensitiveId) return caseInsensitiveId;
  }

  const candidates = [entry.characterName, entry.characterId]
    .map(normalizeLookupToken)
    .filter((candidate) => candidate.length > 0);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const exact = availableSprites.find((sprite) => {
      if (normalizeLookupToken(sprite.characterId) === candidate) return true;
      return normalizeNameAliases(sprite.characterName).includes(candidate);
    });
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const fuzzyName = availableSprites.find((sprite) =>
      normalizeNameAliases(sprite.characterName).some((alias) => hasUsefulContainmentMatch(candidate, alias)),
    );
    if (fuzzyName) return fuzzyName;
  }

  return null;
}

function resolveExpression(expression: string, availableExpressions: string[]): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  const prefixMatches = availableExpressions.filter((entry) => getExpressionPrefixVariant(entry, trimmed));
  const randomPrefixMatch = prefixMatches.length > 1 ? pickRandomExpression(prefixMatches) : null;
  if (randomPrefixMatch) return randomPrefixMatch;

  const exact = availableExpressions.find((entry) => entry.toLowerCase() === lower);
  if (exact) return exact;

  const normalized = normalizeExpressionToken(trimmed);
  const normalizedExact = availableExpressions.find((entry) => normalizeExpressionToken(entry) === normalized);
  if (normalizedExact) return normalizedExact;

  return (
    availableExpressions.find((entry) => {
      const option = normalizeExpressionToken(entry);
      return hasUsefulContainmentMatch(normalized, option);
    }) ?? null
  );
}

export function validateSpriteExpressionEntries<T extends SpriteExpressionEntry>(
  expressions: T[] | undefined,
  availableSprites: AvailableSpriteCharacter[] | undefined,
): ExpressionValidationResult<T> {
  const warnings: ExpressionValidationWarning[] = [];
  if (!Array.isArray(expressions) || !Array.isArray(availableSprites)) {
    return { expressions: [], warnings };
  }

  const validated: T[] = [];
  for (const entry of expressions) {
    if (typeof entry.characterId !== "string" && typeof entry.characterName !== "string") {
      warnings.push({ message: "Malformed expression entry without character identity — skipping" });
      continue;
    }
    if (typeof entry.expression !== "string") {
      warnings.push({ message: "Malformed expression entry without expression — skipping" });
      continue;
    }

    const character = resolveCharacter(entry, availableSprites);
    const suppliedIdentity =
      typeof entry.characterId === "string" && entry.characterId.trim()
        ? entry.characterId.trim()
        : typeof entry.characterName === "string" && entry.characterName.trim()
          ? entry.characterName.trim()
          : "unknown";
    if (!character) {
      warnings.push({ message: `Expression agent returned unknown character "${suppliedIdentity}" — removing` });
      continue;
    }

    if (entry.characterId !== character.characterId) {
      warnings.push({
        message: `Expression agent used "${suppliedIdentity}" — resolved to ${character.characterName} (${character.characterId})`,
      });
    }

    const expression = resolveExpression(entry.expression, character.expressions);
    if (!expression) {
      warnings.push({
        message: `Expression agent chose "${entry.expression}" for ${character.characterName} which doesn't exist — removing`,
      });
      continue;
    }

    if (entry.expression !== expression) {
      warnings.push({
        message: `Expression agent chose "${entry.expression}" — correcting to closest match "${expression}"`,
      });
    }

    entry.characterId = character.characterId;
    entry.characterName = character.characterName;
    entry.expression = expression;
    validated.push(entry);
  }

  return { expressions: validated, warnings };
}
