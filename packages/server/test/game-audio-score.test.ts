import test from "node:test";
import assert from "node:assert/strict";
import { scoreAmbient } from "@marinara-engine/shared";

const availableAmbient = [
  "ambient:nature:autumn-wind-leaves",
  "ambient:nature:birds-singing",
  "ambient:nature:howling-wind",
  "ambient:nature:rain-thunder",
  "ambient:nature:river-flowing",
  "ambient:interior:rain-on-roof",
];

test("ambient scoring does not use thunder ambience for plain rain", () => {
  const selected = scoreAmbient({
    state: "exploration",
    weather: "rain",
    timeOfDay: null,
    locationKind: "nature",
    currentAmbient: null,
    availableAmbient,
    background: null,
  });

  assert.ok(selected);
  assert.doesNotMatch(selected, /thunder|storm|lightning/i);
});

test("ambient scoring can use thunder ambience for storm weather", () => {
  const selected = scoreAmbient({
    state: "exploration",
    weather: "storm",
    timeOfDay: null,
    locationKind: "nature",
    currentAmbient: null,
    availableAmbient,
    background: null,
  });

  assert.equal(selected, "ambient:nature:rain-thunder");
});
