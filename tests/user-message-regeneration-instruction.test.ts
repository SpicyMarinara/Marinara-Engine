import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendGenerationTailMessages,
  buildUserMessageRegenerationInstruction,
  buildUserMessageRegenerationPrompt,
  buildUserMessageRegenerationPromptFromSource,
  buildUserMessageRegenerationSourceMessage,
  resolveUserRegenerationPersistentAttachments,
} from "../packages/server/src/routes/generate/generate-route-utils.ts";

describe("user message regeneration instruction", () => {
  it("asks the provider to rewrite the user message as a swipe", () => {
    const instruction = buildUserMessageRegenerationInstruction({ content: "try again" });

    assert.match(instruction, /Regenerate the user's previous message as an alternate swipe/);
    assert.match(instruction, /Write only the replacement user message text/);
    assert.match(instruction, /Do not answer as the assistant/);
    assert.match(instruction, /<original_user_message>\ntry again\n<\/original_user_message>/);
  });

  it("trims original user message whitespace", () => {
    const instruction = buildUserMessageRegenerationInstruction({ content: "  padded message  " });

    assert.match(instruction, /<original_user_message>\npadded message\n<\/original_user_message>/);
  });

  it("includes readable attachments when rebuilding a user-message regeneration prompt", () => {
    const prompt = buildUserMessageRegenerationPrompt({
      content: "summarize this",
      extra: JSON.stringify({
        attachments: [
          {
            type: "text/plain",
            filename: "notes.txt",
            data: "data:text/plain;base64,TGluZSAxCkxpbmUgMg==",
          },
        ],
      }),
    });

    assert.equal(prompt.role, "user");
    assert.match(prompt.content, /<original_user_message>\nsummarize this/);
    assert.match(prompt.content, /<attached_file name="notes.txt" type="text\/plain">/);
    assert.match(prompt.content, /Line 1\nLine 2/);
  });

  it("preserves image attachments when rebuilding a user-message regeneration prompt", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const prompt = buildUserMessageRegenerationPrompt({
      content: "what is in this image?",
      extra: {
        attachments: [
          {
            type: "image/png",
            filename: "image.png",
            data: imageDataUrl,
          },
        ],
      },
    });

    assert.deepEqual(prompt.images, [imageDataUrl]);
  });

  it("ignores malformed attachment metadata when rebuilding a user-message regeneration prompt", () => {
    const prompt = buildUserMessageRegenerationPrompt({
      content: "regenerate this safely",
      extra: { attachments: "not an attachment array" },
    });

    assert.equal(prompt.role, "user");
    assert.equal(prompt.images, undefined);
    assert.match(prompt.content, /<original_user_message>\nregenerate this safely\n<\/original_user_message>/);
  });

  it("ignores malformed attachment array entries when rebuilding a user-message regeneration prompt", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const prompt = buildUserMessageRegenerationPrompt({
      content: "describe this safely",
      extra: {
        attachments: [
          null,
          "not an object",
          123,
          {
            type: "image/png",
            filename: "image.png",
            data: imageDataUrl,
          },
        ],
      },
    });

    assert.match(prompt.content, /<original_user_message>\ndescribe this safely\n<\/original_user_message>/);
    assert.deepEqual(prompt.images, [imageDataUrl]);
  });

  it("returns original attachments for saved user-message regeneration swipes", () => {
    const attachments = [
      {
        type: "text/plain",
        filename: "notes.txt",
        data: "data:text/plain;base64,bm90ZXM=",
      },
      {
        type: "image/png",
        filename: "image.png",
        data: "data:image/png;base64,aW1hZ2U=",
      },
    ];

    const resolved = resolveUserRegenerationPersistentAttachments({
      role: "user",
      extra: { attachments },
    });

    assert.deepEqual(resolved, attachments);
  });

  it("does not persist attachments for regenerated assistant swipes", () => {
    const resolved = resolveUserRegenerationPersistentAttachments({
      role: "assistant",
      extra: {
        attachments: [
          {
            type: "image/png",
            filename: "assistant.png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    });

    assert.equal(resolved, undefined);
  });

  it("filters malformed persisted user-regeneration attachment entries", () => {
    const validAttachment = {
      type: "image/png",
      filename: "valid.png",
      data: "data:image/png;base64,aW1hZ2U=",
    };

    const resolved = resolveUserRegenerationPersistentAttachments({
      role: "user",
      extra: {
        attachments: [null, "bad", 123, ["bad"], validAttachment],
      },
    });

    assert.deepEqual(resolved, [validAttachment]);
  });

  it("ignores malformed attachment metadata when building the regeneration instruction directly", () => {
    const instruction = buildUserMessageRegenerationInstruction({
      content: "direct instruction",
      extra: { attachments: { data: "not an array" } },
    });

    assert.match(instruction, /<original_user_message>\ndirect instruction\n<\/original_user_message>/);
  });

  it("builds a source message from the original regenerated user message", () => {
    const source = buildUserMessageRegenerationSourceMessage({ content: "describe this image" });

    assert.deepEqual(source, { role: "user", content: "describe this image" });
  });

  it("preserves readable attachments in the regeneration source message", () => {
    const source = buildUserMessageRegenerationSourceMessage({
      content: "summarize this",
      extra: {
        attachments: [
          {
            type: "text/plain",
            filename: "notes.txt",
            data: "data:text/plain;base64,TGluZSAxCkxpbmUgMg==",
          },
        ],
      },
    });

    assert.match(source.content, /summarize this/);
    assert.match(source.content, /<attached_file name="notes.txt" type="text\/plain">/);
    assert.match(source.content, /Line 1\nLine 2/);
  });

  it("preserves image attachments in the regeneration source message", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const source = buildUserMessageRegenerationSourceMessage({
      content: "describe this image",
      extra: {
        attachments: [
          {
            type: "image/png",
            filename: "image.png",
            data: imageDataUrl,
          },
        ],
      },
    });

    assert.deepEqual(source.images, [imageDataUrl]);
  });

  it("builds the final regeneration prompt from the transformed source message", () => {
    const source = buildUserMessageRegenerationSourceMessage({
      content: "raw persona name",
      extra: {
        attachments: [
          {
            type: "image/png",
            filename: "image.png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    });
    source.content = source.content.replace("raw persona name", "resolved persona name");

    const prompt = buildUserMessageRegenerationPromptFromSource(source);

    assert.match(prompt.content, /<original_user_message>\nresolved persona name\n<\/original_user_message>/);
    assert.doesNotMatch(prompt.content, /raw persona name/);
    assert.deepEqual(prompt.images, ["data:image/png;base64,aW1hZ2U="]);
  });

  it("ignores malformed attachment metadata in the regeneration source message", () => {
    const source = buildUserMessageRegenerationSourceMessage({
      content: "keep this",
      extra: { attachments: "broken" },
    });

    assert.deepEqual(source, { role: "user", content: "keep this" });
  });

  it("ignores malformed attachment array entries in the regeneration source message", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const source = buildUserMessageRegenerationSourceMessage({
      content: "keep valid image",
      extra: {
        attachments: [
          undefined,
          false,
          {
            type: "image/png",
            filename: "image.png",
            data: imageDataUrl,
          },
        ],
      },
    });

    assert.equal(source.content, "keep valid image");
    assert.deepEqual(source.images, [imageDataUrl]);
  });

  it("keeps Gemini user-message regeneration as the final user turn while preserving assistant prefill", () => {
    const messages = [{ role: "user" as const, content: "context" }];
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    const regenerateUserMessage = buildUserMessageRegenerationPrompt({
      content: "Regenerate the user message",
      extra: {
        attachments: [
          {
            type: "image/png",
            data: imageDataUrl,
          },
        ],
      },
    });

    appendGenerationTailMessages(messages, {
      assistantPrefill: "Assistant prefill test:",
      followUpIteration: 0,
      impersonate: false,
      isGoogleProvider: true,
      regenerateUserMessage,
    });

    assert.deepEqual(messages.slice(-2), [
      { role: "assistant", content: "Assistant prefill test:" },
      regenerateUserMessage,
    ]);
    assert.deepEqual(messages.at(-1)?.images, [imageDataUrl]);
  });

  it("appends a Gemini regeneration prompt rebuilt from the transformed source message", () => {
    const messages = [{ role: "user" as const, content: "context" }];
    const source = buildUserMessageRegenerationSourceMessage({
      content: "before regex",
      extra: {
        attachments: [
          {
            type: "image/png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      },
    });
    source.content = "after regex";
    const regenerateUserMessage = buildUserMessageRegenerationPromptFromSource(source);

    appendGenerationTailMessages(messages, {
      assistantPrefill: "",
      followUpIteration: 0,
      impersonate: false,
      isGoogleProvider: true,
      regenerateUserMessage,
    });

    assert.match(messages.at(-1)?.content ?? "", /<original_user_message>\nafter regex\n<\/original_user_message>/);
    assert.doesNotMatch(messages.at(-1)?.content ?? "", /before regex/);
    assert.deepEqual(messages.at(-1)?.images, ["data:image/png;base64,aW1hZ2U="]);
  });

  it("keeps assistant prefill as the final assistant turn outside Gemini user-message regeneration", () => {
    const messages = [{ role: "user" as const, content: "context" }];

    appendGenerationTailMessages(messages, {
      assistantPrefill: "Continue from here:",
      followUpIteration: 0,
      impersonate: false,
      isGoogleProvider: false,
      regenerateUserMessage: buildUserMessageRegenerationPrompt({ content: "Regenerate the user message" }),
    });

    assert.deepEqual(messages.slice(-1), [{ role: "assistant", content: "Continue from here:" }]);
  });
});
