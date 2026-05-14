import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedGenerationInstructionMessage } from "@marinara-engine/shared";
import {
  applyGenerationReplayToRegenerateInput,
  buildGenerationReplay,
  normalizeGenerationReplay,
  type GenerationReplayInput,
} from "../src/routes/generate/generation-replay.js";

function regenInput(overrides: Partial<GenerationReplayInput> = {}): GenerationReplayInput {
  return {
    userMessage: null,
    impersonate: false,
    generationGuide: null,
    generationGuideSource: null,
    impersonateBlockAgents: false,
    ...overrides,
  };
}

test("replays narrator generation guidance onto a regenerate request", () => {
  const replay = buildGenerationReplay({
    generationGuide: "Take the scene toward the docks.",
    generationGuideSource: "narrator",
  });
  const input = regenInput();

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.generationGuide, "Take the scene toward the docks.");
  assert.equal(input.generationGuideSource, "narrator");
});

test("keeps an explicit regenerate guide instead of replacing it with replayed guidance", () => {
  const replay = buildGenerationReplay({
    generationGuide: "Original slash-command direction.",
    generationGuideSource: "narrator",
  });
  const input = regenInput({
    generationGuide: "Fresh regenerate direction.",
    generationGuideSource: "guide",
  });

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), false);
  assert.equal(input.generationGuide, "Fresh regenerate direction.");
  assert.equal(input.generationGuideSource, "guide");
});

test("replays ordinary guided-regenerate guidance", () => {
  const replay = buildGenerationReplay({
    generationGuide: "Fresh regenerate direction.",
    generationGuideSource: "guide",
  });
  const input = regenInput();

  assert.deepEqual(replay, {
    generationGuide: "Fresh regenerate direction.",
    generationGuideSource: "guide",
  });
  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.generationGuide, "Fresh regenerate direction.");
  assert.equal(input.generationGuideSource, "guide");
});

test("normalizes stored ordinary guide metadata", () => {
  const replay = normalizeGenerationReplay({
    generationGuide: "  stale hidden guide  ",
    generationGuideSource: "guide",
  });
  const input = regenInput();

  assert.deepEqual(replay, {
    generationGuide: "  stale hidden guide  ",
    generationGuideSource: "guide",
  });
  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.generationGuide, "  stale hidden guide  ");
  assert.equal(input.generationGuideSource, "guide");
});

test("replays impersonate direction and overrides onto a regenerate request", () => {
  const replay = buildGenerationReplay({
    impersonate: true,
    userMessage: "Answer like you are hiding something.",
    impersonatePresetId: "preset-1",
    impersonateConnectionId: "connection-1",
    impersonateBlockAgents: true,
    impersonatePromptTemplate: "  Write as {{user}}: {{impersonate_direction}}  ",
  });
  const input = regenInput();

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.impersonate, true);
  assert.equal(input.userMessage, "Answer like you are hiding something.");
  assert.equal(input.impersonatePresetId, "preset-1");
  assert.equal(input.impersonateConnectionId, "connection-1");
  assert.equal(input.impersonateBlockAgents, true);
  assert.equal(input.impersonatePromptTemplate, "  Write as {{user}}: {{impersonate_direction}}  ");
});

test("uses explicit guided regenerate text as the new impersonate direction", () => {
  const replay = buildGenerationReplay({
    impersonate: true,
    userMessage: "Old impersonate direction.",
    impersonatePresetId: "preset-1",
  });
  const input = regenInput({
    generationGuide: buildGuidedGenerationInstructionMessage("New impersonate direction."),
    generationGuideSource: "guide",
  });

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.impersonate, true);
  assert.equal(input.userMessage, "New impersonate direction.");
  assert.equal(input.generationGuide, null);
  assert.equal(input.generationGuideSource, null);
  assert.equal(input.impersonatePresetId, "preset-1");
});

test("clears generic guide injection when an explicit impersonate direction is already present", () => {
  const replay = buildGenerationReplay({
    impersonate: true,
    userMessage: "Old impersonate direction.",
  });
  const input = regenInput({
    userMessage: "Direct impersonate direction.",
    generationGuide: buildGuidedGenerationInstructionMessage("Generic guide."),
    generationGuideSource: "guide",
  });

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.impersonate, true);
  assert.equal(input.userMessage, "Direct impersonate direction.");
  assert.equal(input.generationGuide, null);
  assert.equal(input.generationGuideSource, null);
});

test("preserves stored replay metadata whitespace before applying it", () => {
  const replay = normalizeGenerationReplay({
    impersonate: true,
    userMessage: "  whisper it  ",
    generationGuide: "  keep the scene tense  ",
    generationGuideSource: "narrator",
    impersonateBlockAgents: true,
  });
  const input = regenInput();

  assert.equal(applyGenerationReplayToRegenerateInput(input, replay), true);
  assert.equal(input.impersonate, true);
  assert.equal(input.userMessage, "  whisper it  ");
  assert.equal(input.generationGuide, null);
  assert.equal(input.generationGuideSource, null);
  assert.equal(input.impersonateBlockAgents, true);
});
