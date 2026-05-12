import assert from "node:assert/strict";
import test from "node:test";
import { resolveSceneSummaryMaxTokens } from "../src/routes/scene/scene-route-utils.js";

test("scene summary uses the connection max token override when configured", () => {
  assert.equal(resolveSceneSummaryMaxTokens(16000), 16000);
});

test("scene summary keeps the default max token budget without an override", () => {
  assert.equal(resolveSceneSummaryMaxTokens(null), 1024);
});
