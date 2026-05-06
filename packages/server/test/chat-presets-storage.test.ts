import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePresetMetadata } from "../src/services/storage/chat-presets.storage.js";

test("chat preset metadata sanitization strips scene lifecycle state", () => {
  const sanitized = sanitizePresetMetadata({
    enableAgents: false,
    activeAgentIds: ["agent-a"],
    sceneStatus: "active",
    sceneOriginChatId: "origin-chat",
    sceneDescription: "A temporary scene.",
    sceneFutureKey: "future scene data",
    activeSceneChatId: "scene-chat",
    sceneBusyCharIds: ["char-a"],
  });

  assert.deepEqual(sanitized, {
    enableAgents: false,
    activeAgentIds: ["agent-a"],
  });
});
