import test from "node:test";
import assert from "node:assert/strict";
import { setTimeOfDay, type GameTime } from "../src/services/game/time.service.js";

test("setTimeOfDay keeps repeated scene labels on the same day", () => {
  let time: GameTime = { day: 1, hour: 21, minute: 0 };

  for (let i = 0; i < 5; i++) {
    time = setTimeOfDay(time, "night");
  }

  assert.deepEqual(time, { day: 1, hour: 21, minute: 0 });
});

test("setTimeOfDay advances within the same day for later labels", () => {
  const time = setTimeOfDay({ day: 2, hour: 8, minute: 15 }, "afternoon");

  assert.deepEqual(time, { day: 2, hour: 14, minute: 0 });
});

test("setTimeOfDay rolls over only when moving to an earlier phase", () => {
  const time = setTimeOfDay({ day: 3, hour: 21, minute: 30 }, "morning");

  assert.deepEqual(time, { day: 4, hour: 8, minute: 0 });
});
