export function visibleText(value: string | number | null | undefined, fallback = "Unknown") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getNumberValueWidth(value: number) {
  const text = Number.isFinite(value) ? String(value) : "0";
  return `${Math.min(7, Math.max(1.15, text.length + 0.35))}ch`;
}
