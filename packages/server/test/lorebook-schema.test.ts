import test from "node:test";
import assert from "node:assert/strict";
import { updateLorebookSchema } from "../../shared/src/schemas/lorebook.schema.ts";

test("lorebook updates reject conflicting scalar and array character scopes", () => {
  const result = updateLorebookSchema.safeParse({
    characterId: "character-a",
    characterIds: ["character-b"],
  });

  assert.equal(result.success, false);
});

test("lorebook updates reject conflicting scalar and array persona scopes", () => {
  const result = updateLorebookSchema.safeParse({
    personaId: "persona-a",
    personaIds: ["persona-b"],
  });

  assert.equal(result.success, false);
});

test("lorebook updates reject global scope with specific links", () => {
  const result = updateLorebookSchema.safeParse({
    isGlobal: true,
    characterIds: ["character-a"],
  });

  assert.equal(result.success, false);
});

test("lorebook updates allow clearing links while making a lorebook global", () => {
  const result = updateLorebookSchema.safeParse({
    isGlobal: true,
    characterId: null,
    characterIds: [],
    personaId: null,
    personaIds: [],
  });

  assert.equal(result.success, true);
});
