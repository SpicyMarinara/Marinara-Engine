import test from "node:test";
import assert from "node:assert/strict";
import { resolveMacros, type MacroContext } from "@marinara-engine/shared";

function macroContext(variables: Record<string, string> = {}): MacroContext {
  return {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables,
  };
}

function withMockedRandom(values: number[], run: () => string): string {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = values[index];
    assert.notEqual(value, undefined, "test consumed more random values than expected");
    index += 1;
    return value;
  };

  try {
    const output = run();
    assert.equal(index, values.length, "test did not consume all expected random values");
    return output;
  } finally {
    Math.random = originalRandom;
  }
}

test("random choices respect nested random macros as a single option", () => {
  const output = withMockedRandom([0.3, 0.5], () =>
    resolveMacros(
      "{{random::None::{{random::Alice::Bob::Carl}} appears.::The world ends.::{{random::Doug::Erin::Frank}} leaves.::A nearby car explodes.}}",
      macroContext(),
    ),
  );

  assert.equal(output, "Bob appears.");
});

test("random choices can resolve nested variable macros", () => {
  const output = withMockedRandom([0.2], () =>
    resolveMacros("{{random::{{getvar::actor}} leaves.::The world ends.}}", macroContext({ actor: "Doug" })),
  );

  assert.equal(output, "Doug leaves.");
});

test("setvar values can resolve nested random choices", () => {
  const ctx = macroContext();
  const output = withMockedRandom([0.8], () =>
    resolveMacros("{{setvar::actor::{{random::Alice::Bob}}}}{{getvar::actor}}", ctx),
  );

  assert.equal(output, "Bob");
  assert.equal(ctx.variables.actor, "Bob");
});
