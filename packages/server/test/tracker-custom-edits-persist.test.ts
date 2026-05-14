import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { AgentContext } from "@marinara-engine/shared";
import {
  BaseLLMProvider,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
} from "../src/services/llm/base-provider.js";
import type { AgentExecConfig } from "../src/services/agents/agent-executor.js";
import { executeAgent } from "../src/services/agents/agent-executor.js";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { apiConnections, chats, gameStateSnapshots, messages, messageSwipes } from "../src/db/schema/index.js";
import { chatsRoutes } from "../src/routes/chats.routes.js";
import { registerDryRunRoute } from "../src/routes/generate/dry-run-route.js";
import {
  parseGameStateRow,
  resolveRegenerationGameStateFallbackMessageIds,
  resolveRegenerationGameStateAnchor,
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

class CapturingProvider extends BaseLLMProvider {
  constructor(private readonly captured: ChatMessage[][]) {
    super("", "");
  }

  override async *chat(_messages: ChatMessage[], _options: ChatOptions): AsyncGenerator<string, void, unknown> {
    throw new Error("CapturingProvider.chat is not used in these tests");
  }

  override async chatComplete(messages: ChatMessage[], _options: ChatOptions): Promise<ChatCompletionResult> {
    this.captured.push(messages);
    return {
      content: JSON.stringify({
        fields: [{ name: "Bond", value: "edited mid-session" }],
        reasoning: "No narrative change, so the current value is kept.",
      }),
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

function makeCapturingProvider(captured: ChatMessage[][]): BaseLLMProvider {
  return new CapturingProvider(captured);
}

test("custom tracker edits stay on the visible snapshot and feed continue/retry agent context", async () => {
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
      const visibleForContinue = await gameStateStore.getForGeneration("chat-tracker-edits", {
        preferLatestVisible: true,
        visibleAnchor,
      });
      assert.equal(readCustomTrackerValue(visibleForContinue!, "Bond"), "edited mid-session");

      const captured: ChatMessage[][] = [];
      await executeAgent(
        makeCustomTrackerConfig(),
        makeCustomTrackerContext(parseGameStateRow(visibleForContinue as Record<string, unknown>)),
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

test("regenerate tracker context uses the previous assistant snapshot instead of the target result", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-regen-baseline",
      name: "Tracker regen baseline repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: ["custom-tracker"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values([
      {
        id: "assistant-previous",
        chatId: "chat-regen-baseline",
        role: "assistant",
        characterId: null,
        content: "Previous accepted assistant state.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-14T02:00:00.000Z",
      },
      {
        id: "user-between",
        chatId: "chat-regen-baseline",
        role: "user",
        characterId: null,
        content: "Continue.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-14T02:01:00.000Z",
      },
      {
        id: "assistant-target",
        chatId: "chat-regen-baseline",
        role: "assistant",
        characterId: null,
        content: "The assistant response being regenerated.",
        activeSwipeIndex: 1,
        extra: "{}",
        createdAt: "2026-05-14T02:02:00.000Z",
      },
    ]);
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-regen-previous",
        chatId: "chat-regen-baseline",
        messageId: "assistant-previous",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "previous accepted state" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 1,
        createdAt: "2026-05-14T02:00:30.000Z",
      },
      {
        id: "snapshot-regen-target-first",
        chatId: "chat-regen-baseline",
        messageId: "assistant-target",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "target first swipe result" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T02:03:00.000Z",
      },
      {
        id: "snapshot-regen-target-second",
        chatId: "chat-regen-baseline",
        messageId: "assistant-target",
        swipeIndex: 1,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "target second swipe result" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T02:04:00.000Z",
      },
    ]);

    const orderedMessages = [
      { role: "assistant", id: "assistant-previous", activeSwipeIndex: 0 },
      { role: "user", id: "user-between", activeSwipeIndex: 0 },
      { role: "assistant", id: "assistant-target", activeSwipeIndex: 1 },
    ];
    const gameStateStore = createGameStateStorage(db);

    const visibleAnchor = resolveVisibleGameStateAnchor(orderedMessages);
    const visibleTargetState = await gameStateStore.getForGeneration("chat-regen-baseline", {
      preferLatestVisible: true,
      visibleAnchor,
    });
    assert.equal(readCustomTrackerValue(visibleTargetState!, "Bond"), "target second swipe result");

    const regenAnchor = resolveRegenerationGameStateAnchor(orderedMessages, "assistant-target");
    assert.deepEqual(regenAnchor, { messageId: "assistant-previous", swipeIndex: 0 });

    const regenBaseline = await gameStateStore.getForGeneration("chat-regen-baseline", {
      preferLatestVisible: true,
      visibleAnchor: regenAnchor,
      excludeMessageId: "assistant-target",
    });
    assert.equal(readCustomTrackerValue(regenBaseline!, "Bond"), "previous accepted state");

    const captured: ChatMessage[][] = [];
    await executeAgent(
      makeCustomTrackerConfig(),
      makeCustomTrackerContext(parseGameStateRow(regenBaseline as Record<string, unknown>)),
      makeCapturingProvider(captured),
      "test-model",
    );

    const agentPrompt = captured[0]!.map((message) => message.content).join("\n");
    assert.match(agentPrompt, /previous accepted state/);
    assert.doesNotMatch(agentPrompt, /target first swipe result/);
    assert.doesNotMatch(agentPrompt, /target second swipe result/);

    const cloned = await gameStateStore.updateByMessage("assistant-target", 2, "chat-regen-baseline", {}, undefined, {
      baseSnapshot: regenBaseline,
    });
    assert.equal(readCustomTrackerValue(cloned!, "Bond"), "previous accepted state");

    await db.insert(apiConnections).values({
      id: "conn-dry-run-regenerate",
      name: "Dry run test connection",
      provider: "custom",
      baseUrl: "http://localhost.invalid/v1",
      apiKeyEncrypted: "",
      model: "test-model",
      maxContext: 4096,
      createdAt: now,
      updatedAt: now,
    });

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(registerDryRunRoute);
      await app.ready();

      const dryRunResponse = await app.inject({
        method: "POST",
        url: "/dryRun",
        payload: {
          chatId: "chat-regen-baseline",
          connectionId: "conn-dry-run-regenerate",
          returnPrompt: true,
          skipPreset: true,
          injectTrackers: true,
          regenerateMessageId: "assistant-target",
        },
      });
      assert.equal(dryRunResponse.statusCode, 200);
      const dryRunBody = dryRunResponse.json<{
        prompt: { messages: Array<{ role: string; content: string }> };
      }>();
      const promptText = dryRunBody.prompt.messages.map((message) => message.content).join("\n");
      assert.match(promptText, /previous accepted state/);
      assert.doesNotMatch(promptText, /target first swipe result/);
      assert.doesNotMatch(promptText, /target second swipe result/);
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});

test("regenerate fallback stays bounded before the target assistant", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-regen-bounded-fallback",
      name: "Tracker regen bounded fallback",
      mode: "roleplay",
      characterIds: "[]",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: ["custom-tracker"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values([
      {
        id: "assistant-earlier",
        chatId: "chat-regen-bounded-fallback",
        role: "assistant",
        characterId: null,
        content: "Earlier assistant state.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-14T02:00:00.000Z",
      },
      {
        id: "assistant-previous-missing",
        chatId: "chat-regen-bounded-fallback",
        role: "assistant",
        characterId: null,
        content: "Previous assistant has no active tracker row.",
        activeSwipeIndex: 1,
        extra: "{}",
        createdAt: "2026-05-14T02:01:00.000Z",
      },
      {
        id: "assistant-target-bounded",
        chatId: "chat-regen-bounded-fallback",
        role: "assistant",
        characterId: null,
        content: "Target assistant being regenerated.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-14T02:02:00.000Z",
      },
      {
        id: "assistant-future",
        chatId: "chat-regen-bounded-fallback",
        role: "assistant",
        characterId: null,
        content: "Later assistant state must not leak backward.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-14T02:03:00.000Z",
      },
    ]);
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-bounded-earlier",
        chatId: "chat-regen-bounded-fallback",
        messageId: "assistant-earlier",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "earlier safe fallback" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 1,
        createdAt: "2026-05-14T02:00:30.000Z",
      },
      {
        id: "snapshot-bounded-target",
        chatId: "chat-regen-bounded-fallback",
        messageId: "assistant-target-bounded",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "target output" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T02:02:30.000Z",
      },
      {
        id: "snapshot-bounded-future",
        chatId: "chat-regen-bounded-fallback",
        messageId: "assistant-future",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "future leak" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 1,
        createdAt: "2026-05-14T02:04:00.000Z",
      },
    ]);

    const orderedMessages = [
      { role: "assistant", id: "assistant-earlier", activeSwipeIndex: 0 },
      { role: "assistant", id: "assistant-previous-missing", activeSwipeIndex: 1 },
      { role: "assistant", id: "assistant-target-bounded", activeSwipeIndex: 0 },
      { role: "assistant", id: "assistant-future", activeSwipeIndex: 0 },
    ];
    const regenAnchor = resolveRegenerationGameStateAnchor(orderedMessages, "assistant-target-bounded");
    assert.deepEqual(regenAnchor, { messageId: "assistant-previous-missing", swipeIndex: 1 });

    const boundedFallback = await createGameStateStorage(db).getForGeneration("chat-regen-bounded-fallback", {
      preferLatestVisible: true,
      visibleAnchor: regenAnchor,
      excludeMessageId: "assistant-target-bounded",
      fallbackMessageIds: resolveRegenerationGameStateFallbackMessageIds(
        orderedMessages,
        "assistant-target-bounded",
      ),
    });
    assert.equal(readCustomTrackerValue(boundedFallback!, "Bond"), "earlier safe fallback");
  } finally {
    client.close();
  }
});

test("manual overrides persist when targeted update creates a fresh swipe snapshot", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-manual-create",
      name: "Manual override create repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(gameStateSnapshots).values({
      id: "snapshot-manual-base",
      chatId: "chat-manual-create",
      messageId: "assistant-base",
      swipeIndex: 0,
      date: null,
      time: null,
      location: "Old location",
      weather: null,
      temperature: null,
      presentCharacters: "[]",
      recentEvents: "[]",
      playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "base" }])),
      personaStats: null,
      manualOverrides: null,
      committed: 1,
      createdAt: "2026-05-14T02:05:00.000Z",
    });

    const gameStateStore = createGameStateStorage(db);
    const updated = await gameStateStore.updateByMessage(
      "assistant-fresh",
      0,
      "chat-manual-create",
      { location: "Edited location" },
      true,
    );

    assert.equal(updated?.location, "Edited location");
    assert.deepEqual(JSON.parse((updated?.manualOverrides as string) ?? "{}"), { location: "Edited location" });
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

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const reloadResponse = await app.inject({
        method: "GET",
        url: "/api/chats/chat-missing-visible-snapshot/game-state",
      });
      assert.equal(reloadResponse.statusCode, 200);
      const reloaded = reloadResponse.json<{ playerStats: ReturnType<typeof playerStats> }>();
      assert.equal(reloaded.playerStats.customTrackerFields[0]?.value, "committed baseline");
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});

test("deleting a swipe keeps game-state snapshots aligned with shifted swipe indexes", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-delete-swipe-snapshots",
      name: "Delete swipe snapshots repro",
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
      id: "assistant-delete-swipe",
      chatId: "chat-delete-swipe-snapshots",
      role: "assistant",
      characterId: null,
      content: "Third swipe reply.",
      activeSwipeIndex: 2,
      extra: "{}",
      createdAt: "2026-05-14T01:10:00.000Z",
    });
    await db.insert(messageSwipes).values([
      {
        id: "delete-swipe-first",
        messageId: "assistant-delete-swipe",
        index: 0,
        content: "First swipe reply.",
        extra: "{}",
        createdAt: "2026-05-14T01:10:00.000Z",
      },
      {
        id: "delete-swipe-middle",
        messageId: "assistant-delete-swipe",
        index: 1,
        content: "Middle swipe reply.",
        extra: "{}",
        createdAt: "2026-05-14T01:11:00.000Z",
      },
      {
        id: "delete-swipe-third",
        messageId: "assistant-delete-swipe",
        index: 2,
        content: "Third swipe reply.",
        extra: "{}",
        createdAt: "2026-05-14T01:12:00.000Z",
      },
    ]);
    await db.insert(gameStateSnapshots).values([
      {
        id: "snapshot-delete-first",
        chatId: "chat-delete-swipe-snapshots",
        messageId: "assistant-delete-swipe",
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
        createdAt: "2026-05-14T01:10:30.000Z",
      },
      {
        id: "snapshot-delete-middle",
        chatId: "chat-delete-swipe-snapshots",
        messageId: "assistant-delete-swipe",
        swipeIndex: 1,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "deleted middle" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T01:11:30.000Z",
      },
      {
        id: "snapshot-delete-third",
        chatId: "chat-delete-swipe-snapshots",
        messageId: "assistant-delete-swipe",
        swipeIndex: 2,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: "[]",
        recentEvents: "[]",
        playerStats: JSON.stringify(playerStats([{ name: "Bond", value: "surviving third" }])),
        personaStats: null,
        manualOverrides: null,
        committed: 0,
        createdAt: "2026-05-14T01:12:30.000Z",
      },
    ]);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: "/api/chats/chat-delete-swipe-snapshots/messages/assistant-delete-swipe/swipes/1",
      });
      assert.equal(deleteResponse.statusCode, 200);

      const activeResponse = await app.inject({
        method: "GET",
        url: "/api/chats/chat-delete-swipe-snapshots/game-state",
      });
      assert.equal(activeResponse.statusCode, 200);
      const active = activeResponse.json<{ playerStats: ReturnType<typeof playerStats> }>();
      assert.equal(active.playerStats.customTrackerFields[0]?.value, "surviving third");

      const gameStateStore = createGameStateStorage(db);
      const shiftedThird = await gameStateStore.getByMessage("assistant-delete-swipe", 1);
      assert.equal(readCustomTrackerValue(shiftedThird!, "Bond"), "surviving third");
      assert.equal(await gameStateStore.getByMessage("assistant-delete-swipe", 2), null);
    } finally {
      await app.close();
    }
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
