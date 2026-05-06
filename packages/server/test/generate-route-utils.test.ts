import test from "node:test";
import assert from "node:assert/strict";
import { shouldEnableAgentsForGeneration } from "../src/routes/generate/generate-route-utils.js";

test("disables agents before resolution when impersonate blocks agents", () => {
  assert.equal(
    shouldEnableAgentsForGeneration({
      chatEnableAgents: true,
      chatMode: "roleplay",
      impersonate: true,
      impersonateBlockAgents: true,
    }),
    false,
  );
});

test("disables agents when the chat agent setting is off", () => {
  const cases = [
    { chatMode: "roleplay", impersonate: false, impersonateBlockAgents: false },
    { chatMode: "game", impersonate: true, impersonateBlockAgents: false },
    { chatMode: "visual_novel", impersonate: true, impersonateBlockAgents: true },
  ];

  for (const item of cases) {
    assert.equal(
      shouldEnableAgentsForGeneration({
        chatEnableAgents: false,
        chatMode: item.chatMode,
        impersonate: item.impersonate,
        impersonateBlockAgents: item.impersonateBlockAgents,
      }),
      false,
    );
  }
});

test("keeps agents enabled for impersonation when blocking is disabled", () => {
  assert.equal(
    shouldEnableAgentsForGeneration({
      chatEnableAgents: true,
      chatMode: "roleplay",
      impersonate: true,
      impersonateBlockAgents: false,
    }),
    true,
  );
});

test("keeps agents enabled for normal roleplay generations", () => {
  assert.equal(
    shouldEnableAgentsForGeneration({
      chatEnableAgents: true,
      chatMode: "roleplay",
      impersonate: false,
      impersonateBlockAgents: true,
    }),
    true,
  );
});

test("keeps agents enabled for game and visual novel modes", () => {
  for (const chatMode of ["game", "visual_novel"]) {
    assert.equal(
      shouldEnableAgentsForGeneration({
        chatEnableAgents: true,
        chatMode,
        impersonate: false,
        impersonateBlockAgents: false,
      }),
      true,
    );
  }
});

test("keeps conversation mode agent pipeline disabled", () => {
  assert.equal(
    shouldEnableAgentsForGeneration({
      chatEnableAgents: true,
      chatMode: "conversation",
      impersonate: false,
      impersonateBlockAgents: false,
    }),
    false,
  );
});
