import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canUseMessageForUserRegeneration } from "../packages/server/src/routes/generate/generate-route-utils.ts";

describe("user message regeneration hidden-from-AI guard", () => {
  it("allows visible user messages when hidden-from-AI filtering is supported", () => {
    assert.equal(
      canUseMessageForUserRegeneration({
        message: { role: "user", extra: { hiddenFromAI: false } },
        supportsHiddenFromAI: true,
      }),
      true,
    );
  });

  it("rejects hidden user messages when hidden-from-AI filtering is supported", () => {
    assert.equal(
      canUseMessageForUserRegeneration({
        message: { role: "user", extra: { hiddenFromAI: true } },
        supportsHiddenFromAI: true,
      }),
      false,
    );
  });

  it("does not reject hidden user messages in modes without hidden-from-AI filtering", () => {
    assert.equal(
      canUseMessageForUserRegeneration({
        message: { role: "user", extra: { hiddenFromAI: true } },
        supportsHiddenFromAI: false,
      }),
      true,
    );
  });

  it("does not reject non-user messages through the user regeneration guard", () => {
    assert.equal(
      canUseMessageForUserRegeneration({
        message: { role: "assistant", extra: { hiddenFromAI: true } },
        supportsHiddenFromAI: true,
      }),
      true,
    );
  });
});
