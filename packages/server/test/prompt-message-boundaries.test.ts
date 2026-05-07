import test from "node:test";
import assert from "node:assert/strict";
import { mergeAdjacentMessages } from "../src/services/prompt/merger.js";

test("provider normalization keeps post-history prompt instructions separate from the last user turn", () => {
  const merged = mergeAdjacentMessages([
    { role: "system", content: "<role>Role instructions</role>", contextKind: "prompt" },
    { role: "user", content: "<chat_history>Earlier user turn", contextKind: "history" },
    { role: "assistant", content: "Earlier assistant turn</chat_history>", contextKind: "history" },
    { role: "user", content: "<last_message>Latest user turn</last_message>", contextKind: "history" },
    { role: "user", content: "<output_format>Write the response.</output_format>", contextKind: "prompt" },
  ]);

  assert.deepEqual(
    merged.map((message) => ({ role: message.role, contextKind: message.contextKind, content: message.content })),
    [
      { role: "system", contextKind: "prompt", content: "<role>Role instructions</role>" },
      { role: "user", contextKind: "history", content: "<chat_history>Earlier user turn" },
      { role: "assistant", contextKind: "history", content: "Earlier assistant turn</chat_history>" },
      { role: "user", contextKind: "history", content: "<last_message>Latest user turn</last_message>" },
      { role: "user", contextKind: "prompt", content: "<output_format>Write the response.</output_format>" },
    ],
  );
});

test("provider normalization still merges adjacent messages from the same context bucket", () => {
  const merged = mergeAdjacentMessages([
    { role: "system", content: "<role>Role instructions</role>", contextKind: "prompt" },
    { role: "system", content: "<lore>Setting details</lore>", contextKind: "prompt" },
    { role: "user", content: "Earlier user turn", contextKind: "history" },
    { role: "user", content: "Another user fragment", contextKind: "history" },
  ]);

  assert.deepEqual(
    merged.map((message) => ({ role: message.role, contextKind: message.contextKind, content: message.content })),
    [
      {
        role: "system",
        contextKind: "prompt",
        content: "<role>Role instructions</role>\n\n<lore>Setting details</lore>",
      },
      { role: "user", contextKind: "history", content: "Earlier user turn\n\nAnother user fragment" },
    ],
  );
});
