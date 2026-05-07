import test from "node:test";
import assert from "node:assert/strict";
import { fitMessagesToContext, type ChatMessage } from "../src/services/llm/base-provider.js";

const repeated = (label: string, chars: number) => `${label}: ${"x".repeat(chars)}`;

test("context fitting removes marked chat history before prompt data", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: repeated("prompt", 1000) },
    { role: "user", content: repeated("old user", 4000), contextKind: "history" },
    { role: "assistant", content: repeated("old assistant", 4000), contextKind: "history" },
    { role: "user", content: "current turn", contextKind: "history" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 700, maxTokens: 200 });

  assert.equal(
    fit.messages.some((message) => message.content.includes("prompt:")),
    true,
  );
  assert.equal(
    fit.messages.some((message) => message.content.includes("old user:")),
    false,
  );
  assert.equal(
    fit.messages.some((message) => message.content.includes("old assistant:")),
    false,
  );
  assert.equal(fit.messages.at(-1)?.content, "current turn");
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});

test("context fitting reduces completion budget before truncating protected prompt data", () => {
  const prompt = repeated("protected prompt", 1600);
  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: "current turn" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 700, maxTokens: 500 });

  assert.equal(fit.messages[0]?.content, prompt);
  assert.ok((fit.maxTokens ?? 0) < 500);
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});

test("context fitting trims old history before collapsing a usable completion budget", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: repeated("prompt", 100) },
    { role: "user", content: repeated("old user", 3000), contextKind: "history" },
    { role: "user", content: "current turn", contextKind: "history" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 1000, maxTokens: 300 });

  assert.equal(fit.maxTokens, 300);
  assert.equal(
    fit.messages.some((message) => message.content.includes("old user:")),
    false,
  );
  assert.equal(fit.messages.at(-1)?.content, "current turn");
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});

test("context fitting trims unmarked old turns before collapsing a usable completion budget", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: repeated("prompt", 100) },
    { role: "user", content: repeated("old unmarked user", 3000) },
    { role: "user", content: "current turn" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 1000, maxTokens: 300 });

  assert.equal(fit.maxTokens, 300);
  assert.equal(
    fit.messages.some((message) => message.content.includes("old unmarked user:")),
    false,
  );
  assert.equal(fit.messages.at(-1)?.content, "current turn");
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});

test("context fitting reduces completion budget before removing non-history prompt blocks", () => {
  const importantPromptBlock = repeated("important setup", 2600);
  const messages: ChatMessage[] = [
    { role: "system", content: repeated("prompt", 100) },
    { role: "user", content: importantPromptBlock },
    { role: "assistant", content: repeated("old assistant", 300), contextKind: "history" },
    { role: "user", content: "current turn", contextKind: "history" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 1000, maxTokens: 300 });

  assert.equal(
    fit.messages.some((message) => message.content === importantPromptBlock),
    true,
  );
  assert.equal(
    fit.messages.some((message) => message.content.includes("old assistant:")),
    false,
  );
  assert.equal(fit.messages.at(-1)?.content, "current turn");
  assert.ok((fit.maxTokens ?? 0) < 300);
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});

test("context fitting preserves agent context by reducing oversized local output budget first", () => {
  const prompt = repeated("agent prompt", 1000);
  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: repeated("agent history user", 4000), contextKind: "history" },
    { role: "assistant", content: repeated("agent history assistant", 4000), contextKind: "history" },
    { role: "user", content: repeated("current turn", 2000), contextKind: "history" },
  ];

  const fit = fitMessagesToContext(messages, { maxContext: 8192, maxTokens: 8192 });

  assert.equal(fit.trimmed, false);
  assert.equal(fit.messages.length, messages.length);
  assert.equal(fit.estimatedTokensAfter, fit.estimatedTokensBefore);
  assert.ok((fit.inputBudget ?? 0) > 128);
  assert.ok((fit.maxTokens ?? 0) < 8192);
  assert.ok((fit.estimatedTokensAfter ?? 0) <= (fit.inputBudget ?? 0));
});
