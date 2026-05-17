import type { PresentCharacter } from "@marinara-engine/shared";
import type { SpriteInfo } from "../../../hooks/use-characters";
import { parseMetadataRecord } from "./tracker-metadata";

export function normalizeSpriteExpressionMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const expressions: Record<string, string> = {};
  for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
    if (typeof expression !== "string") continue;
    const trimmed = expression.trim();
    if (key && trimmed) expressions[key] = trimmed;
  }
  return expressions;
}

export function getLatestSpriteExpressionsFromMessages(
  messages: Array<{ role?: string; extra?: unknown }> | undefined,
) {
  if (!messages?.length) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const extra = parseMetadataRecord(message.extra);
    const expressions = normalizeSpriteExpressionMap(extra.spriteExpressions);
    if (Object.keys(expressions).length > 0) return expressions;
  }
  return null;
}

export function isSpriteLookupCharacterId(characterId: string | null | undefined) {
  const id = characterId?.trim();
  return !!id && !id.startsWith("manual-") && !id.startsWith("party-npc:");
}

export function getSpriteExpressionForCharacter(
  expressions: Record<string, string>,
  character: PresentCharacter,
  spriteCharacterId: string | null,
) {
  if (spriteCharacterId && expressions[spriteCharacterId]) return expressions[spriteCharacterId];
  if (character.characterId && expressions[character.characterId]) return expressions[character.characterId];
  if (character.name && expressions[character.name]) return expressions[character.name];
  return undefined;
}

export function getCharacterExpressionHint(character: PresentCharacter, spriteExpression?: string | null) {
  if (spriteExpression?.trim()) return spriteExpression.trim();
  const text = [character.mood, character.thoughts].filter(Boolean).join(" ").toLowerCase();
  if (/\b(angry|furious|rage|snarl|seeth)\b/.test(text)) return "angry";
  if (/\b(sad|sorrow|cry|tears|weep|grief)\b/.test(text)) return "sad";
  if (/\b(happy|joy|laugh|smile|cheer|delight|giggl)\b/.test(text)) return "happy";
  if (/\b(surpris|shock|gasp|startle)\b/.test(text)) return "surprised";
  if (/\b(scared|afraid|fear|panic|trembl)\b/.test(text)) return "scared";
  if (/\b(blush|embarrass|fluster|shy)\b/.test(text)) return "embarrassed";
  if (/\b(think|ponder|wonder|consider|hmm)\b/.test(text)) return "thinking";
  if (/\b(worr|anxious|nervous|concern|dread)\b/.test(text)) return "worried";
  if (/\b(smirk|sly|teas|mischiev)\b/.test(text)) return "smirk";
  if (/\b(determin|resolv|steadfast)\b/.test(text)) return "determined";
  return "neutral";
}

export function resolveSpriteUrl(sprites: SpriteInfo[] | undefined, expression: string) {
  const spriteList = (sprites ?? []).filter((sprite) => !sprite.expression.toLowerCase().startsWith("full_"));
  if (spriteList.length === 0) return null;
  const exprLower = expression.toLowerCase();
  const exact = spriteList.find((sprite) => sprite.expression.toLowerCase() === exprLower);
  if (exact) return exact.url;
  const partial = spriteList.find((sprite) => {
    const stored = sprite.expression.trim().toLowerCase();
    if (!stored) return false;
    return stored.includes(exprLower) || exprLower.includes(stored);
  });
  if (partial) return partial.url;
  const neutral = spriteList.find((sprite) => {
    const stored = sprite.expression.toLowerCase();
    return stored === "neutral" || stored === "default" || stored === "idle";
  });
  return neutral?.url ?? spriteList[0]?.url ?? null;
}
