import test from "node:test";
import assert from "node:assert/strict";
import { validateSpriteExpressionEntries } from "../src/routes/generate/expression-agent-utils.js";

const availableSprites = [
  {
    characterId: "current-silas-id",
    characterName: "Silas Everheart",
    expressions: ["neutral", "happy_smile", "worried"],
  },
  {
    characterId: "dottore-current-id",
    characterName: "Il Dottore",
    expressions: ["neutral", "angry", "soft_smile"],
  },
];

test("repairs stale expression character ids using the returned character name", () => {
  const result = validateSpriteExpressionEntries(
    [
      {
        characterId: "xr0F8hBCle0E8oh6Q7xUF",
        characterName: "Silas Everheart",
        expression: "Happy Smile",
      },
    ],
    availableSprites,
  );

  assert.equal(result.expressions.length, 1);
  assert.equal(result.expressions[0]?.characterId, "current-silas-id");
  assert.equal(result.expressions[0]?.characterName, "Silas Everheart");
  assert.equal(result.expressions[0]?.expression, "happy_smile");
  assert.match(result.warnings.map((warning) => warning.message).join("\n"), /resolved to Silas Everheart/);
});

test("matches character names even when title prefixes are omitted", () => {
  const result = validateSpriteExpressionEntries(
    [
      {
        characterId: "Dottore",
        expression: "angry",
      },
    ],
    availableSprites,
  );

  assert.equal(result.expressions.length, 1);
  assert.equal(result.expressions[0]?.characterId, "dottore-current-id");
  assert.equal(result.expressions[0]?.characterName, "Il Dottore");
  assert.equal(result.expressions[0]?.expression, "angry");
});

test("drops expressions that cannot be matched to the available sprite catalog", () => {
  const result = validateSpriteExpressionEntries(
    [
      {
        characterId: "unknown-character-id",
        characterName: "Somebody Else",
        expression: "neutral",
      },
    ],
    availableSprites,
  );

  assert.deepEqual(result.expressions, []);
  assert.match(result.warnings.map((warning) => warning.message).join("\n"), /unknown character/);
});
