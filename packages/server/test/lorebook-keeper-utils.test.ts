import test from "node:test";
import assert from "node:assert/strict";
import {
  loadLorebookKeeperExistingEntries,
  mergeLorebookKeeperUpdateContent,
  persistLorebookKeeperUpdates,
} from "../src/routes/generate/lorebook-keeper-utils.js";

test("loads existing lorebook entry content for Keeper context", async () => {
  const lorebooksStore = {
    async listEntries(lorebookId: string) {
      assert.equal(lorebookId, "book-1");
      return [
        {
          id: "entry-1",
          name: "Snezhnaya",
          content: "The city is built around a frozen harbor.",
          keys: ["Snezhnaya", "frozen harbor"],
          locked: false,
        },
      ];
    },
  } as unknown as Parameters<typeof loadLorebookKeeperExistingEntries>[0];

  const entries = await loadLorebookKeeperExistingEntries(lorebooksStore, "book-1");

  assert.deepEqual(entries, [
    {
      id: "entry-1",
      name: "Snezhnaya",
      content: "The city is built around a frozen harbor.",
      keys: ["Snezhnaya", "frozen harbor"],
      locked: false,
    },
  ]);
});

test("falls back to replacement content for older Lorebook Keeper update payloads", () => {
  const merged = mergeLorebookKeeperUpdateContent({
    existingContent: "Old content.",
    replacementContent: "Old content plus a model-merged addition.",
    newFacts: undefined,
  });

  assert.equal(merged, "Old content plus a model-merged addition.");
});

test("keeps legacy content-based updates append-only when old details are missing", () => {
  const merged = mergeLorebookKeeperUpdateContent({
    existingContent: "The old entry mentions a sealed blue door.",
    replacementContent: "The new scene reveals a silver key.",
    newFacts: undefined,
  });

  assert.equal(merged, "The old entry mentions a sealed blue door.\n\nThe new scene reveals a silver key.");
});

test("explicit Lorebook Keeper update content overwrites existing entries", async () => {
  let savedPatch: Record<string, unknown> | null = null;
  const lorebooksStore = {
    async listEntries(lorebookId: string) {
      assert.equal(lorebookId, "book-1");
      return [
        {
          id: "entry-1",
          name: "TargetEntry",
          content: "Status: Professional Employer-Employee\n\nStatus: Candid Professionalism",
          keys: ["TargetEntry", "old key"],
          tag: "relationship",
          locked: false,
        },
      ];
    },
    async updateEntry(entryId: string, patch: Record<string, unknown>) {
      assert.equal(entryId, "entry-1");
      savedPatch = patch;
      return null;
    },
  } as unknown as Parameters<typeof persistLorebookKeeperUpdates>[0]["lorebooksStore"];

  await persistLorebookKeeperUpdates({
    lorebooksStore,
    chatId: "chat-1",
    chatName: "Test Chat",
    preferredTargetLorebookId: "book-1",
    writableLorebookIds: ["book-1"],
    updates: [
      {
        action: "update",
        entryName: "TargetEntry",
        content: "Status: Playful Professionalism",
        keys: ["TargetEntry", "new key"],
        tag: "relationship",
      },
    ],
  });

  assert.deepEqual(savedPatch, {
    content: "Status: Playful Professionalism",
    keys: ["TargetEntry", "old key", "new key"],
    tag: "relationship",
  });
});

test("Lorebook Keeper newFacts updates remain append-only", async () => {
  let savedPatch: Record<string, unknown> | null = null;
  const lorebooksStore = {
    async listEntries() {
      return [
        {
          id: "entry-1",
          name: "TargetEntry",
          content: "The old entry mentions a sealed blue door.",
          keys: ["TargetEntry"],
          tag: "lore",
          locked: false,
        },
      ];
    },
    async updateEntry(_entryId: string, patch: Record<string, unknown>) {
      savedPatch = patch;
      return null;
    },
  } as unknown as Parameters<typeof persistLorebookKeeperUpdates>[0]["lorebooksStore"];

  await persistLorebookKeeperUpdates({
    lorebooksStore,
    chatId: "chat-1",
    chatName: "Test Chat",
    preferredTargetLorebookId: "book-1",
    writableLorebookIds: ["book-1"],
    updates: [
      {
        action: "update",
        entryName: "TargetEntry",
        newFacts: ["The new scene reveals a silver key."],
      },
    ],
  });

  assert.deepEqual(savedPatch, {
    content: "The old entry mentions a sealed blue door.\n\n- The new scene reveals a silver key.",
    keys: ["TargetEntry"],
    tag: "lore",
  });
});
