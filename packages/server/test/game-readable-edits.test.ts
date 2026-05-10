import test from "node:test";
import assert from "node:assert/strict";
import { parseGameJsonish } from "../src/services/game/jsonish.js";
import { createJournal, addNoteEntry } from "../src/services/game/journal.service.js";
import { applySegmentEdits } from "../src/services/game/segment-edits.js";

test("addNoteEntry updates an existing readable by source segment instead of duplicating it", () => {
  const initial = addNoteEntry(createJournal(), "Note", "Old wording", {
    readableType: "note",
    sourceMessageId: "msg-1",
    sourceSegmentIndex: 2,
  });

  const updated = addNoteEntry(initial, "Note", "Corrected wording", {
    readableType: "note",
    sourceMessageId: "msg-1",
    sourceSegmentIndex: 2,
  });

  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0]?.content, "Corrected wording");
  assert.equal(updated.entries[0]?.sourceMessageId, "msg-1");
  assert.equal(updated.entries[0]?.sourceSegmentIndex, 2);
  assert.equal(updated.entries[0]?.readableType, "note");
});

test("applySegmentEdits rebuilds readable tags with edited content", () => {
  const content = [
    "The drawer sticks for a second before it opens.",
    "",
    "[Note: The old passphrase is carved into the underside of the desk.]",
  ].join("\n");

  const edited = applySegmentEdits(content, {
    1: {
      readableContent: "The new passphrase is hidden under the bronze lamp.",
      readableType: "note",
    },
  });

  assert.match(edited, /\[Note: The new passphrase is hidden under the bronze lamp\.\]/);
  assert.doesNotMatch(edited, /old passphrase/);
});

test("parseGameJsonish unwraps JSON objects returned as escaped strings", () => {
  const setupPayload = {
    worldOverview: "A small town waits under festival lights.",
    storyArc: "The opening mystery starts at the amusement pier.",
    plotTwists: ["The mascot knows where the missing tickets went."],
    startingNpcs: [{ name: "Laila", description: "Runs the prize stall.", location: "pier", reputation: 0 }],
    blueprint: {
      hudWidgets: [
        {
          id: "laila_amusement",
          type: "gauge",
          label: "Laila's Amusement",
          position: "hud_left",
          accent: "#ff7da0",
          config: { value: 20, max: 100, dangerBelow: 10 },
        },
      ],
      introSequence: [{ effect: "fade_from_black", duration: 3 }],
      visualTheme: { palette: "pastel", uiStyle: "glassy", moodDefault: "cheerful" },
    },
  };

  const parsed = parseGameJsonish(JSON.stringify(JSON.stringify(setupPayload)));

  assert.deepEqual(parsed, setupPayload);
});
