// Pure keyword-matching helpers for lorebook entries.
// Server scanning and the in-editor keyword-test preview share these so the
// preview cannot drift from the real activation rules.

import type { SelectiveLogic } from "../types/lorebook.js";

export interface KeywordMatchOptions {
  useRegex: boolean;
  matchWholeWords: boolean;
  caseSensitive: boolean;
}

/** Test whether a single keyword would match the given text under the given options. */
export function testKeyword(keyword: string, text: string, options: KeywordMatchOptions): boolean {
  if (!keyword) return false;

  try {
    if (options.useRegex) {
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(keyword, flags);
      return regex.test(text);
    }

    const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
    const haystack = options.caseSensitive ? text : text.toLowerCase();

    if (options.matchWholeWords) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(`\\b${escaped}\\b`, flags);
      return regex.test(text);
    }

    return haystack.includes(needle);
  } catch {
    // Invalid regex — fall back to plain substring
    const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
    const haystack = options.caseSensitive ? text : text.toLowerCase();
    return haystack.includes(needle);
  }
}

/** Primary key set: any single key matching counts as a match. */
export function testPrimaryKeys(
  keys: string[],
  text: string,
  options: KeywordMatchOptions,
): { matched: boolean; matchedKeys: string[] } {
  const matchedKeys: string[] = [];
  for (const key of keys) {
    if (testKeyword(key, text, options)) {
      matchedKeys.push(key);
    }
  }
  return { matched: matchedKeys.length > 0, matchedKeys };
}

/** Secondary key set with selective logic (and/or/not). Empty list passes. */
export function testSecondaryKeys(
  secondaryKeys: string[],
  text: string,
  logic: SelectiveLogic,
  options: KeywordMatchOptions,
): boolean {
  if (secondaryKeys.length === 0) return true;

  const results = secondaryKeys.map((key) => testKeyword(key, text, options));

  switch (logic) {
    case "and":
      return results.every(Boolean);
    case "or":
      return results.some(Boolean);
    case "not":
      return !results.some(Boolean);
    default:
      return true;
  }
}
