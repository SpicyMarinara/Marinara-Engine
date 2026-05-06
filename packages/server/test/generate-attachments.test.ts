import test from "node:test";
import assert from "node:assert/strict";
import {
  appendReadableAttachmentsToContent,
  extractImageAttachmentDataUrls,
} from "../src/routes/generate/generate-route-utils.js";

function dataUrl(text: string, type = "application/json"): string {
  return `data:${type};base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

test("text attachments are appended to model-visible message content", () => {
  const content = appendReadableAttachmentsToContent("Please inspect this card.", [
    {
      type: "application/json",
      filename: "character.json",
      data: dataUrl('{"name":"Rinha","description":"Test card"}'),
    },
  ]);

  assert.match(content, /Please inspect this card\./);
  assert.match(content, /<attached_file name="character\.json" type="application\/json">/);
  assert.match(content, /"name":"Rinha"/);
  assert.match(content, /<\/attached_file>/);
});

test("extension-based text attachments work when browsers omit mime types", () => {
  const content = appendReadableAttachmentsToContent("", [
    {
      type: "",
      name: "notes.md",
      data: dataUrl("# Lore", "text/markdown"),
    },
  ]);

  assert.match(content, /<attached_file name="notes\.md"/);
  assert.match(content, /# Lore/);
});

test("image attachments are extracted separately from readable text attachments", () => {
  const image = "data:image/png;base64,abc123";
  assert.deepEqual(
    extractImageAttachmentDataUrls([
      { type: "image/png", data: image, filename: "portrait.png" },
      { type: "application/json", data: dataUrl("{}"), filename: "card.json" },
    ]),
    [image],
  );
});
