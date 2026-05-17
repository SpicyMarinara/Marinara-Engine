import test from "node:test";
import assert from "node:assert/strict";
import { isPatternSafe, testKeyword } from "@marinara-engine/shared";
import { createTimeoutRegexExecutor } from "../src/services/lorebook/regex-timeout.js";

test("isPatternSafe accepts simple safe patterns", () => {
  assert.equal(isPatternSafe(""), true);
  assert.equal(isPatternSafe("foo"), true);
  assert.equal(isPatternSafe("foo|bar"), true);
  assert.equal(isPatternSafe("foo+"), true);
  assert.equal(isPatternSafe("foo.*bar"), true);
  assert.equal(isPatternSafe("(foo)"), true);
  assert.equal(isPatternSafe("(foo)+"), true);
  assert.equal(isPatternSafe("\\d+"), true);
  assert.equal(isPatternSafe("[a-z]+"), true);
  assert.equal(isPatternSafe("[^abc]*"), true);
  assert.equal(isPatternSafe("\\bword\\b"), true);
  assert.equal(isPatternSafe("(?:foo|bar){1,5}"), true);
  assert.equal(isPatternSafe("(?<name>foo)"), true);
  assert.equal(isPatternSafe("foo(?=bar)"), true);
});

test("isPatternSafe rejects nested-quantifier ReDoS shapes", () => {
  assert.equal(isPatternSafe("(a+)+"), false);
  assert.equal(isPatternSafe("(a*)*"), false);
  assert.equal(isPatternSafe("(a+)*"), false);
  assert.equal(isPatternSafe("(a*)+"), false);
  assert.equal(isPatternSafe("(a+|b)+"), false);
  assert.equal(isPatternSafe("(.*)+"), false);
  assert.equal(isPatternSafe("(\\d+)+$"), false);
  assert.equal(isPatternSafe("((ab)+)+"), false);
});

test("isPatternSafe rejects oversized patterns and pathological repetition", () => {
  assert.equal(isPatternSafe("a".repeat(1001)), false);
  assert.equal(isPatternSafe("a{1,200}"), false);
  assert.equal(isPatternSafe("a{500}"), false);
  assert.equal(isPatternSafe("a{1,}"), false); // unbounded upper -> Infinity > maxRepetition
  assert.equal(isPatternSafe("a{1,99}"), true);
});

test("isPatternSafe handles unbalanced groups defensively", () => {
  assert.equal(isPatternSafe("(foo"), false);
  assert.equal(isPatternSafe("foo)"), false);
  assert.equal(isPatternSafe("[foo"), false);
});

test("testKeyword falls back to literal substring on unsafe regex", () => {
  // (a+)+ is unsafe; with literal-substring fallback the keyword "(a+)+" matches
  // only text containing the literal string "(a+)+", not arbitrary "aaaa".
  assert.equal(
    testKeyword("(a+)+", "aaaaaaaaaaaaaaaaaaaa", { useRegex: true, matchWholeWords: false, caseSensitive: false }),
    false,
  );
  assert.equal(
    testKeyword("(a+)+", "the literal (a+)+ token", { useRegex: true, matchWholeWords: false, caseSensitive: false }),
    true,
  );
});

test("testKeyword still matches safe regex patterns end-to-end", () => {
  assert.equal(
    testKeyword("foo|bar", "the bar is open", { useRegex: true, matchWholeWords: false, caseSensitive: false }),
    true,
  );
  assert.equal(
    testKeyword("\\bword\\b", "this is a word here", { useRegex: true, matchWholeWords: false, caseSensitive: false }),
    true,
  );
});

test("vmRegexExecutor aborts catastrophic backtracking under timeout", () => {
  // The canonical alternation-overlap ReDoS shape passes isPatternSafe (star-height 1)
  // but still backtracks catastrophically on the right input. This is exactly the case
  // the executor's timeout is for — the static check can't predict input-dependent blow-up.
  const regex = /^(a|aa)+$/;
  const exec = createTimeoutRegexExecutor(50);
  const start = Date.now();
  const result = exec(regex, "a".repeat(28) + "!");
  const elapsed = Date.now() - start;
  // Either timeout fired (result false, elapsed ~50-200ms) or the regex completed quickly
  // on faster hardware — either way it must NOT pin the thread for orders of magnitude past the timeout.
  assert.equal(result, false);
  assert.ok(elapsed < 1000, `expected timeout to abort within ~1s, took ${elapsed}ms`);
});

test("vmRegexExecutor passes safe patterns through unchanged", () => {
  const exec = createTimeoutRegexExecutor(50);
  assert.equal(exec(/foo/, "foo bar"), true);
  assert.equal(exec(/foo/, "baz qux"), false);
  assert.equal(exec(/^\d+$/, "12345"), true);
  assert.equal(exec(/^\d+$/, "12a45"), false);
});
