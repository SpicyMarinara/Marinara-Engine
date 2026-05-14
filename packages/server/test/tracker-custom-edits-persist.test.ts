import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { AgentContext } from "@marinara-engine/shared";
import type { BaseLLMProvider, ChatCompletionResult, ChatMessage } from "../src/services/llm/base-provider.js";
import type { AgentExecConfig } from "../src/services/agents/agent-executor.js";
import { executeAgent } from "../src/services/agents/agent-executor.js";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { chats, gameStateSnapshots, messages, messageSwipes } from "../src/db/schema/index.js";
import { chatsRoutes } from "../src/routes/chats.routes.js";
import {
  parseGameStateRow,
  resolveVisibleGameStateAnchor,
  shouldPreferLatestVisibleGameState,
} from "../src/routes/generate/generate-route-utils.js";
import { createGameStateStorage } from "../src/services/storage/game-state.storage.js";

const now = "2026-05-14T00:00:00.000Z";

function playerStats(customTrackerFields: Array<{ name: string; value: string }>) {
  return {
    stats: [],
    attributes: null,
    skills: {},
    inventory: [],
    activeQuests: [],
    status: "",
    customTrackerFields,
  };
}

function readCustomTrackerValue(row: { playerStats: unknown }, name: string) {
  const stats = typeof row.playerStats === "string" ? JSON.parse(row.playerStats) : row.playerStats;
  const fields = (stats as { customTrackerFields?: Array<{ name: string; value: string }> } | null)
    ?.customTrackerFields;
  return fields?.find((field) => field.name === name)?.value;
}

function makeCustomTrackerContext(gameState: AgentContext["gameState"]): AgentContext {
  return {
    chatId: "chat-tracker-edits",
    chatMode: "roleplay",
    recentMessages: [
      { role: "user", content: "Check the tracker." },
      { role: "assistant", content: "Nothing in the scene changes the field." },
    ],
    mainResponse: "The scene continues without changing the tracked bond.",
    gameState,
    characters: [],
    persona: null,
    memory: {},
    activatedLorebookEntries: [],
    writableLorebookIds: null,
    chatSummary: null,
    streaming: false,
  };
}

function makeCustomTrackerConfig(): AgentExecConfig {
  return {
    id: "agent-custom-tracker",
    type: "custom-tracker",
    name: "Custom Tracker",
    phase: "post_processing",
    promptTemplate: "",
    connectionId: null,
    settings: {},
  };
}

function makeCapturingProvider(captured: ChatMessage[][]): BaseLLMProvider {
  return {
    get maxTokensOverrideValue() {
      return null;
    },
    chatComplete: async (messages: ChatMessage[]): Promise<ChatCompletionResult> => {
      captured.push(messages);
      return {
        content: JSON.stringify({
          fields: [{ name: "Bond", value: "edited mid-session" }],
          reasoning: "No narrative change, so the current value is kept.",
        }),
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
  } as unknown as BaseLLMProvider;
}

test("custom tracker edits stay on the visible snapshot and feed regenerate/retry agent context", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-tracker-edits",
      name: "Tracker edits repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: ["custom-tracker"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values({
      id: "assistant-current",
      chatId: "chat-tracker-edits",
      role: "assistant",
      characterId: null,
      content: "The old reply.",
      activeSwipeIndex: 0,
      extra: "{}",
      createdAt: "2026-05-14T00:01:00.000Z",
    });
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-committed",
        chatId: "chat-tracker-edits",
        messageId: "assistant-previous",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "original forever" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 1,
        createdAt: "2026-05-14T00:00:00.000Z",
      },
      {
        id: "snapshot-visible",
        chatId: "chat-tracker-edits",
        messageId: "assistant-current",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "original forever" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T00:02:00.000Z",
      },
      {
        id: "snapshot-inactive-newer",
        chatId: "chat-tracker-edits",
        messageId: "assistant-current",
        swipeIndex: 1,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "inactive newer swipe" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T00:03:00.000Z",
      },
    ]);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const patchResponse = await app.inject({
        method: "PATCH",
        url: "/api/chats/chat-tracker-edits/game-state",
        payload: {
          manual: true,
          playerStats: playerStats([{ name: "Bond", value: "edited mid-session" }]),
        },
      });
      assert.equal(patchResponse.statusCode, 200);

      const reloadResponse = await app.inject({
        method: "GET",
        url: "/api/chats/chat-tracker-edits/game-state",
      });
      assert.equal(reloadResponse.statusCode, 200);
      const reloaded = reloadResponse.json<{ playerStats: ReturnType<typeof playerStats> }>();
      assert.equal(reloaded.playerStats.customTrackerFields[0]?.value, "edited mid-session");

      const gameStateStore = createGameStateStorage(db);
      const committedDefault = await gameStateStore.getForGeneration("chat-tracker-edits");
      assert.equal(readCustomTrackerValue(committedDefault!, "Bond"), "original forever");

      const newestByTimestamp = await gameStateStore.getLatest("chat-tracker-edits");
      assert.equal(readCustomTrackerValue(newestByTimestamp!, "Bond"), "inactive newer swipe");

      const visibleAnchor = resolveVisibleGameStateAnchor([
        { role: "assistant", id: "assistant-current", activeSwipeIndex: 0 },
      ]);
      const visibleForRegenerate = await gameStateStore.getForGeneration("chat-tracker-edits", {
        preferLatestVisible: true,
        visibleAnchor,
      });
      assert.equal(readCustomTrackerValue(visibleForRegenerate!, "Bond"), "edited mid-session");

      const captured: ChatMessage[][] = [];
      await executeAgent(
        makeCustomTrackerConfig(),
        makeCustomTrackerContext(parseGameStateRow(visibleForRegenerate as Record<string, unknown>)),
        makeCapturingProvider(captured),
        "test-model",
      );

      const agentPrompt = captured[0]!.map((message) => message.content).join("\n");
      assert.match(agentPrompt, /<current_game_state>/);
      assert.match(agentPrompt, /"customTrackerFields":\[\{"name":"Bond","value":"edited mid-session"\}\]/);
      assert.doesNotMatch(agentPrompt, /original forever/);
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});

test("visible generation fallback does not use a newer inactive swipe when the active swipe has no snapshot", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-missing-visible-snapshot",
      name: "Missing visible snapshot",
      mode: "roleplay",
      characterIds: "[]",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: ["custom-tracker"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values({
      id: "assistant-missing-visible",
      chatId: "chat-missing-visible-snapshot",
      role: "assistant",
      characterId: null,
      content: "The active swipe has no tracker row.",
      activeSwipeIndex: 0,
      extra: "{}",
      createdAt: "2026-05-14T01:00:00.000Z",
    });
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-missing-visible-committed",
        chatId: "chat-missing-visible-snapshot",
        messageId: "assistant-previous",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "committed baseline" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 1,
        createdAt: "2026-05-14T01:01:00.000Z",
      },
      {
        id: "snapshot-missing-visible-inactive-newer",
        chatId: "chat-missing-visible-snapshot",
        messageId: "assistant-missing-visible",
        swipeIndex: 1,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "inactive newer swipe" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T01:02:00.000Z",
      },
    ]);

    const gameStateStore = createGameStateStorage(db);
    const newestByTimestamp = await gameStateStore.getLatest("chat-missing-visible-snapshot");
    assert.equal(readCustomTrackerValue(newestByTimestamp!, "Bond"), "inactive newer swipe");

    const fallbackForVisible = await gameStateStore.getForGeneration("chat-missing-visible-snapshot", {
      preferLatestVisible: true,
      visibleAnchor: { messageId: "assistant-missing-visible", swipeIndex: 0 },
    });
    assert.equal(readCustomTrackerValue(fallbackForVisible!, "Bond"), "committed baseline");
  } finally {
    client.close();
  }
});

test("queued tracker saves keep their original swipe target after the visible swipe changes", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-queued-swipe-save",
      name: "Queued swipe save repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: ["custom-tracker"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values({
      id: "assistant-with-swipes",
      chatId: "chat-queued-swipe-save",
      role: "assistant",
      characterId: null,
      content: "Second swipe reply.",
      activeSwipeIndex: 1,
      extra: "{}",
      createdAt: "2026-05-14T02:00:00.000Z",
    });
    await db.insert(messageSwipes).values([
      {
        id: "swipe-first",
        messageId: "assistant-with-swipes",
        index: 0,
        content: "First swipe reply.",
        extra: "{}",
        createdAt: "2026-05-14T02:00:00.000Z",
      },
      {
        id: "swipe-second",
        messageId: "assistant-with-swipes",
        index: 1,
        content: "Second swipe reply.",
        extra: "{}",
        createdAt: "2026-05-14T02:01:00.000Z",
      },
    ]);
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-first-swipe",
        chatId: "chat-queued-swipe-save",
        messageId: "assistant-with-swipes",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "first swipe" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T02:00:00.000Z",
      },
      {
        id: "snapshot-second-swipe",
        chatId: "chat-queued-swipe-save",
        messageId: "assistant-with-swipes",
        swipeIndex: 1,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "second swipe before queued save" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T02:01:00.000Z",
      },
    ]);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const switchToFirst = await app.inject({
        method: "PUT",
        url: "/api/chats/chat-queued-swipe-save/messages/assistant-with-swipes/active-swipe",
        payload: { index: 0 },
      });
      assert.equal(switchToFirst.statusCode, 200);

      const queuedSave = await app.inject({
        method: "PATCH",
        url: "/api/chats/chat-queued-swipe-save/game-state",
        payload: {
          manual: true,
          messageId: "assistant-with-swipes",
          swipeIndex: 1,
          playerStats: playerStats([{ name: "Bond", value: "second swipe queued edit" }]),
        },
      });
      assert.equal(queuedSave.statusCode, 200);

      const activeFirstResponse = await app.inject({
        method: "GET",
        url: "/api/chats/chat-queued-swipe-save/game-state",
      });
      assert.equal(activeFirstResponse.statusCode, 200);
      const activeFirst = activeFirstResponse.json<{ playerStats: ReturnType<typeof playerStats> }>();
      assert.equal(activeFirst.playerStats.customTrackerFields[0]?.value, "first swipe");

      const gameStateStore = createGameStateStorage(db);
      const secondSwipeRow = await gameStateStore.getByMessage("assistant-with-swipes", 1);
      assert.equal(readCustomTrackerValue(secondSwipeRow!, "Bond"), "second swipe queued edit");

      const switchBackToSecond = await app.inject({
        method: "PUT",
        url: "/api/chats/chat-queued-swipe-save/messages/assistant-with-swipes/active-swipe",
        payload: { index: 1 },
      });
      assert.equal(switchBackToSecond.statusCode, 200);

      const activeSecondResponse = await app.inject({
        method: "GET",
        url: "/api/chats/chat-queued-swipe-save/game-state",
      });
      assert.equal(activeSecondResponse.statusCode, 200);
      const activeSecond = activeSecondResponse.json<{ playerStats: ReturnType<typeof playerStats> }>();
      assert.equal(activeSecond.playerStats.customTrackerFields[0]?.value, "second swipe queued edit");
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});

test("generation state selection prefers visible tracker edits only when no user turn is saved", () => {
  assert.equal(shouldPreferLatestVisibleGameState({ userMessage: "next turn" }), false);
  assert.equal(shouldPreferLatestVisibleGameState({ attachments: [{ name: "note.txt" }] }), false);
  assert.equal(shouldPreferLatestVisibleGameState({ regenerateMessageId: "assistant-1" }), true);
  assert.equal(shouldPreferLatestVisibleGameState({ userMessage: "" }), true);
  assert.equal(shouldPreferLatestVisibleGameState({ impersonate: true, userMessage: "as user" }), true);
});
