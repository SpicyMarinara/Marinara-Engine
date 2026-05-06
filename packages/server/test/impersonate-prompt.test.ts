import test from "node:test";
import assert from "node:assert/strict";
import { buildImpersonateInstruction } from "../src/services/conversation/impersonate-prompt.js";

test("builds a custom impersonate prompt by appending the direction", () => {
  assert.equal(
    buildImpersonateInstruction({
      customPrompt: "You will now play as my OC:",
      direction: "I do this",
      personaName: "Mari",
    }),
    "You will now play as my OC: I do this.",
  );
});

test("resolves the user macro in custom impersonate prompts", () => {
  assert.equal(
    buildImpersonateInstruction({
      customPrompt: "Write as {{user}}:",
      direction: "wave",
      personaName: "Mari",
    }),
    "Write as Mari: wave.",
  );
});

test("resolves persona and direction macros in custom impersonate prompts", () => {
  assert.equal(
    buildImpersonateInstruction({
      customPrompt: "Write as {{user}}.\nPersona: {{persona_description}}\nDirection: {{impersonate_direction}}",
      direction: "keep it quiet",
      personaName: "Mari",
      personaDescription: "A precise engineer.",
    }),
    "Write as Mari.\nPersona: A precise engineer.\nDirection: keep it quiet",
  );
});

test("keeps the default impersonate instruction when no custom prompt is set", () => {
  const instruction = buildImpersonateInstruction({
    direction: "answer coldly",
    personaName: "Mari",
    personaDescription: "A precise engineer.",
  });

  assert.match(instruction, /You are now writing as Mari/);
  assert.match(instruction, /Character description: A precise engineer\./);
  assert.match(instruction, /Additional direction for this reply: answer coldly/);
});
