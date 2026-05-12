import test from "node:test";
import assert from "node:assert/strict";
import { buildGenerationPromptPresetCandidates } from "../src/routes/generate/prompt-preset-selection.js";

test("connection prompt preset overrides chat preset for roleplay modes", () => {
  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "roleplay",
      chatPromptPresetId: "chat-preset",
      connectionPromptPresetId: "connection-preset",
    }),
    [
      { id: "connection-preset", source: "connection" },
      { id: "chat-preset", source: "chat" },
    ],
  );

  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "visual_novel",
      chatPromptPresetId: "chat-preset",
      connectionPromptPresetId: "connection-preset",
    }),
    [
      { id: "connection-preset", source: "connection" },
      { id: "chat-preset", source: "chat" },
    ],
  );
});

test("explicit impersonate preset stays ahead of connection prompt preset", () => {
  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "roleplay",
      chatPromptPresetId: "chat-preset",
      connectionPromptPresetId: "connection-preset",
      impersonate: true,
      impersonatePromptPresetId: "impersonate-preset",
    }),
    [
      { id: "impersonate-preset", source: "impersonate" },
      { id: "connection-preset", source: "connection" },
      { id: "chat-preset", source: "chat" },
    ],
  );
});

test("connection prompt preset does not affect conversation or game prompt flows", () => {
  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "conversation",
      chatPromptPresetId: "chat-preset",
      connectionPromptPresetId: "connection-preset",
    }),
    [],
  );

  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "game",
      chatPromptPresetId: "chat-preset",
      connectionPromptPresetId: "connection-preset",
    }),
    [{ id: "chat-preset", source: "chat" }],
  );
});

test("duplicate prompt preset candidates are collapsed in priority order", () => {
  assert.deepEqual(
    buildGenerationPromptPresetCandidates({
      chatMode: "roleplay",
      chatPromptPresetId: "same-preset",
      connectionPromptPresetId: "same-preset",
      requestPromptPresetId: "same-preset",
    }),
    [{ id: "same-preset", source: "request" }],
  );
});
