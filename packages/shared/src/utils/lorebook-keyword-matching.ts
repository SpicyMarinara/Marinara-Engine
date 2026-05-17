// Pure keyword-matching helpers for lorebook entries.
// Server scanning and the in-editor keyword-test preview share these so the
// preview cannot drift from the real activation rules.

import type { SelectiveLogic } from "../types/lorebook.js";
import { isPatternSafe } from "./regex-safety.js";

/** Pluggable executor for compiled regex test calls. Server passes a vm-timeout-bounded executor. */
export type RegexExecutor = (regex: RegExp, text: string) => boolean;

const defaultRegexExecutor: RegexExecutor = (regex, text) => regex.test(text);

export interface KeywordMatchOptions {
  useRegex: boolean;
  matchWholeWords: boolean;
  caseSensitive: boolean;
  /** Optional override for executing user-supplied regex patterns. Server injects a
   *  vm.runInNewContext-bounded executor so a pathological pattern that survived the
   *  static safety check can still be aborted. Only applied to the `useRegex` path —
   *  the matchWholeWords branch builds its regex from escaped-literal text and cannot
   *  ReDoS, so it skips the executor (and its per-call vm overhead). */
  regexExecutor?: RegexExecutor;
}

function literalMatch(keyword: string, text: string, options: KeywordMatchOptions): boolean {
  const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  return haystack.includes(needle);
}

/** Test whether a single keyword would match the given text under the given options. */
export function testKeyword(keyword: string, text: string, options: KeywordMatchOptions): boolean {
  if (!keyword) return false;

  try {
    if (options.useRegex) {
      // Static ReDoS guard: refuse to compile patterns with nested quantifiers,
      // pathological repetition counts, or oversized sources. Fall back to literal
      // substring match — same posture as the existing invalid-regex catch below.
      if (!isPatternSafe(keyword)) {
        return literalMatch(keyword, text, options);
      }
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(keyword, flags);
      const exec = options.regexExecutor ?? defaultRegexExecutor;
      return exec(regex, text);
    }

    if (options.matchWholeWords) {
      const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(`\\b${escaped}\\b`, flags);
      // No regexExecutor here — pattern is built from escaped-literal text, can't ReDoS.
      return regex.test(text);
    }

    return literalMatch(keyword, text, options);
  } catch {
    // Invalid regex or executor failure — fall back to plain substring
    return literalMatch(keyword, text, options);
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
