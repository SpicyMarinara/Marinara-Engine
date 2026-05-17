import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext } from "@marinara-engine/shared";
import type { BaseLLMProvider, ChatMessage, ChatCompletionResult } from "../src/services/llm/base-provider.js";
import {
  buildKnowledgeRetrievalAgentMessagesForTest,
  executeAgent,
  executeAgentBatch,
  normalizeAgentContextSize,
  type AgentExecConfig,
} from "../src/services/agents/agent-executor.js";

function makeExpressionContext(): AgentContext {
  const oldMessages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `ancient-history-marker-${index} ${"old context ".repeat(200)}`,
  }));

  return {
    chatId: "chat-1",
    chatMode: "roleplay",
    recentMessages: [
      ...oldMessages,
      { role: "user", content: "Can you answer her question?" },
      { role: "assistant", content: "She waits quietly, trying not to look nervous." },
    ],
    mainResponse: "Mira's shoulders ease, and she answers with a small, relieved smile.",
    gameState: null,
    characters: [
      {
        id: "mira",
        name: "Mira",
        description: `character-description-marker ${"very long character card ".repeat(300)}`,
      },
    ],
    persona: {
      name: "Player",
      description: `persona-description-marker ${"very long persona ".repeat(300)}`,
    },
    memory: {
      _availableSprites: [{ characterId: "mira", characterName: "Mira", expressions: ["neutral", "happy", "worried"] }],
    },
    activatedLorebookEntries: [
      { id: "lore-1", name: "Lore", tag: "world", content: `lore-marker ${"very long lore ".repeat(300)}` },
    ],
    writableLorebookIds: null,
    chatSummary: `summary-marker ${"very long summary ".repeat(300)}`,
    streaming: false,
  };
}

function makeConfig(type: string, settings: Record<string, unknown> = {}): AgentExecConfig {
  return {
    id: `${type}-id`,
    type,
    name: type,
    phase: "post_processing",
    promptTemplate: `Return valid JSON for ${type}.`,
    connectionId: null,
    settings,
  };
}

function makeCapturingProvider(captured: ChatMessage[][]): BaseLLMProvider {
  return {
    get maxTokensOverrideValue() {
      return null;
    },
    chatComplete: async (messages: ChatMessage[]): Promise<ChatCompletionResult> => {
      captured.push(messages);
      const system = messages[0]?.content ?? "";
      const content = system.includes("world-state")
        ? '{"date":null,"time":null,"location":null,"weather":null,"temperature":null}'
        : '{"expressions":[]}';
      return {
        content,
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
  } as unknown as BaseLLMProvider;
}

test("normalizes runaway agent context sizes as message counts", () => {
  assert.equal(normalizeAgentContextSize(12_000), 200);
  assert.equal(normalizeAgentContextSize("7"), 7);
  assert.equal(normalizeAgentContextSize(0), 5);
});

test("expression agent prompt stays compact and omits unrelated lore", async () => {
  const captured: ChatMessage[][] = [];
  const provider = makeCapturingProvider(captured);

  await executeAgent(
    makeConfig("expression", { contextSize: 12_000 }),
    makeExpressionContext(),
    provider,
    "test-model",
  );

  assert.equal(captured.length, 1);
  const prompt = captured[0]!.map((message) => message.content).join("\n");

  assert.match(prompt, /<available_sprites>/);
  assert.match(prompt, /Mira \(mira\): neutral, happy, worried/);
  assert.match(prompt, /relieved smile/);
  assert.doesNotMatch(prompt, /ancient-history-marker-0/);
  assert.doesNotMatch(prompt, /character-description-marker/);
  assert.doesNotMatch(prompt, /persona-description-marker/);
  assert.doesNotMatch(prompt, /lore-marker/);
  assert.doesNotMatch(prompt, /summary-marker/);
  assert.ok(prompt.length < 10_000);
});

test("batched execution runs expression separately from larger tracker prompts", async () => {
  const captured: ChatMessage[][] = [];
  const provider = makeCapturingProvider(captured);

  await executeAgentBatch(
    [makeConfig("world-state", { contextSize: 12_000 }), makeConfig("expression", { contextSize: 1 })],
    makeExpressionContext(),
    provider,
    "test-model",
  );

  assert.equal(captured.length, 2);

  const expressionCall = captured.find((messages) =>
    messages.some((message) => message.content.includes("expression-selection agent")),
  );
  assert.ok(expressionCall);
  const expressionPrompt = expressionCall.map((message) => message.content).join("\n");
  assert.doesNotMatch(expressionPrompt, /agent_task id="world-state"/);
  assert.doesNotMatch(expressionPrompt, /ancient-history-marker-0/);
});

test("knowledge retrieval receives conversation as neutral source context", () => {
  const messages = buildKnowledgeRetrievalAgentMessagesForTest(
    makeConfig("knowledge-retrieval", { contextSize: 5 }),
    "Extract relevant source facts only.",
    {
      ...makeExpressionContext(),
      recentMessages: [
        { role: "user", content: "Let's enter the old library." },
        { role: "assistant", characterId: "mira", content: "Mira opens the door and whispers about dusk." },
      ],
      memory: {
        _sourceMaterial: "## Old Library\nThe old library closes at dusk.",
      },
    },
  );

  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.role), ["system", "user"]);

  const system = messages[0]!.content;
  const user = messages[1]!.content;
  assert.match(system, /<source_material>/);
  assert.match(system, /old library closes at dusk/i);
  assert.match(system, /do not roleplay, continue the conversation/i);
  assert.doesNotMatch(system, /Fulfill the requested task here/);
  assert.match(user, /<conversation_messages>/);
  assert.match(user, /Player: Let's enter the old library\./);
  assert.match(user, /Mira: Mira opens the door/);
  assert.match(user, /Now return the requested format\./);
});
