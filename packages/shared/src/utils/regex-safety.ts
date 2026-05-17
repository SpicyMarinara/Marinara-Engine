// Static safety heuristic for user-supplied regex patterns.
//
// Catches the most common ReDoS shapes — nested quantifiers like (a+)+, (a*)*,
// (a+|b)+ — plus pathological repetition counts and oversized sources, before
// the pattern is ever handed to RegExp.
//
// Not a full safe-regex replacement: false negatives are possible against
// expert-crafted patterns that pass star-height inspection but still backtrack
// catastrophically. The server-side timeout executor in
// packages/server/src/services/lorebook/regex-timeout.ts is the second line of
// defense for those cases.

export interface PatternSafetyOptions {
  /** Reject any source string longer than this. Default 1000. */
  maxLength?: number;
  /** Reject star height greater than this. 1 allows `a+`, `(a+)`, `(a)+`; rejects `(a+)+`. Default 1. */
  maxStarHeight?: number;
  /** Reject `{n,m}` (or `{n,}`) where m (or the unbounded upper) exceeds this. Default 100. */
  maxRepetition?: number;
}

const DEFAULTS: Required<PatternSafetyOptions> = {
  maxLength: 1000,
  maxStarHeight: 1,
  maxRepetition: 100,
};

/**
 * Decide whether a regex source string is safe to compile and run against
 * untrusted input. Returns false for patterns likely to cause catastrophic
 * backtracking; the caller should fall back to literal substring matching.
 */
export function isPatternSafe(source: string, options: PatternSafetyOptions = {}): boolean {
  const { maxLength, maxStarHeight, maxRepetition } = { ...DEFAULTS, ...options };

  if (typeof source !== "string") return false;
  if (source.length === 0) return true;
  if (source.length > maxLength) return false;

  // Walk the source once, tracking:
  //   - whether we are inside a character class (where quantifier semantics differ)
  //   - whether the previous character is escaped
  //   - the stack of group "has-quantifier-after-close" markers, to compute star height
  //
  // Star height here is the maximum number of nested groups whose closing `)`
  // is followed by a quantifier (`*`, `+`, `?`, `{n,m}`), counted along with
  // immediate-quantifier atoms. A bare `a+` has star height 1; `(a+)+` has 2.
  //
  // The walker is deliberately conservative — it does not need to be a full
  // regex parser to catch the common ReDoS shapes.

  let i = 0;
  let groupDepth = 0;
  // For each open group, the running max star height of atoms inside it.
  const groupInnerHeight: number[] = [];
  let topLevelHeight = 0;

  const recordAtomHeight = (h: number) => {
    if (groupDepth > 0) {
      const idx = groupInnerHeight.length - 1;
      if (h > groupInnerHeight[idx]!) groupInnerHeight[idx] = h;
    } else if (h > topLevelHeight) {
      topLevelHeight = h;
    }
  };

  while (i < source.length) {
    const c = source[i]!;

    if (c === "\\") {
      // Escape: skip the next char (counts as one atom)
      const next = source[i + 1];
      if (next !== undefined) {
        // If the escape is followed by a quantifier, atom contributes height 1
        const after = source[i + 2];
        const quantHeight = isQuantifierStart(after) ? 1 : 0;
        recordAtomHeight(quantHeight);
        i += 2;
        if (quantHeight > 0) {
          const consumed = consumeQuantifier(source, i, maxRepetition);
          if (consumed === null) return false;
          i = consumed;
        }
        continue;
      }
      return false; // Trailing backslash
    }

    if (c === "[") {
      // Character class is one atom; consume the whole class via lookahead and
      // pick up any quantifier sitting after the closing `]`.
      const closeIdx = findCharClassClose(source, i);
      if (closeIdx === -1) return false;
      const after = source[closeIdx + 1];
      const quantHeight = isQuantifierStart(after) ? 1 : 0;
      recordAtomHeight(quantHeight);
      i = closeIdx + 1;
      if (quantHeight > 0) {
        const consumed = consumeQuantifier(source, i, maxRepetition);
        if (consumed === null) return false;
        i = consumed;
      }
      continue;
    }

    if (c === "(") {
      groupDepth += 1;
      groupInnerHeight.push(0);
      // Skip group prefix: (?:, (?=, (?!, (?<=, (?<!, (?<name>
      if (source[i + 1] === "?") {
        if (source[i + 2] === "<" && source[i + 3] !== "=" && source[i + 3] !== "!") {
          // Named capture (?<name>...)
          const close = source.indexOf(">", i + 3);
          if (close === -1) return false;
          i = close + 1;
        } else {
          i += 3; // (?: (?= (?! (?<= (?<!  — skip the prefix chars; lookbehind needs +1 more but we re-check below
          if (source[i - 1] === "<") i += 1; // (?<=  or (?<!  — already consumed up to `<`, advance past `=`/`!`
        }
      } else {
        i += 1;
      }
      continue;
    }

    if (c === ")") {
      const innerHeight = groupInnerHeight.pop() ?? 0;
      groupDepth -= 1;
      const after = source[i + 1];
      const quantified = isQuantifierStart(after);
      const groupHeight = innerHeight + (quantified ? 1 : 0);
      if (groupHeight > maxStarHeight) return false;
      recordAtomHeight(groupHeight);
      i += 1;
      if (quantified) {
        const consumed = consumeQuantifier(source, i, maxRepetition);
        if (consumed === null) return false;
        i = consumed;
      }
      continue;
    }

    // Plain literal character: atom of height 0 unless quantified, then 1.
    const after = source[i + 1];
    const quantHeight = isQuantifierStart(after) ? 1 : 0;
    recordAtomHeight(quantHeight);
    i += 1;
    if (quantHeight > 0) {
      const consumed = consumeQuantifier(source, i, maxRepetition);
      if (consumed === null) return false;
      i = consumed;
    }
  }

  if (groupDepth !== 0) return false; // Unbalanced
  if (topLevelHeight > maxStarHeight) return false;
  return true;
}

function isQuantifierStart(ch: string | undefined): boolean {
  return ch === "*" || ch === "+" || ch === "?" || ch === "{";
}

/** Advance past a quantifier starting at `i`, validating `{n,m}` bounds. Returns new index, or null if invalid/over budget. */
function consumeQuantifier(source: string, i: number, maxRepetition: number): number | null {
  const c = source[i];
  if (c === "*" || c === "+" || c === "?") {
    // Optional lazy/possessive marker
    const next = source[i + 1];
    return next === "?" || next === "+" ? i + 2 : i + 1;
  }
  if (c === "{") {
    const close = source.indexOf("}", i + 1);
    if (close === -1) return null;
    const body = source.slice(i + 1, close);
    const m = /^(\d+)(,(\d*))?$/.exec(body);
    if (!m) return null;
    const lo = Number(m[1]);
    const upperRaw = m[3];
    const hi = m[2] === undefined ? lo : upperRaw === "" || upperRaw === undefined ? Infinity : Number(upperRaw);
    if (!Number.isFinite(lo) || lo > maxRepetition) return null;
    if (!Number.isFinite(hi) || hi > maxRepetition) return null;
    let next = close + 1;
    if (source[next] === "?" || source[next] === "+") next += 1;
    return next;
  }
  return i;
}

function findCharClassClose(source: string, openIdx: number): number {
  // The first ] after [ closes the class, except for an immediate `]` which is literal in many
  // dialects. Account for `[]...]` and escape sequences.
  let j = openIdx + 1;
  if (source[j] === "^") j += 1;
  if (source[j] === "]") j += 1; // Leading ] is literal
  while (j < source.length) {
    const c = source[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "]") return j;
    j += 1;
  }
  return -1;
}
