import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  agentConfigs,
  apiConnections,
  characters,
  chats,
  messages,
  messageSwipes,
} from "../src/db/schema/index.js";
import { generateRoutes } from "../src/routes/generate.routes.js";

const now = "2026-05-12T12:00:00.000Z";

function buildCharacterData(id: string, name: string) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      id,
      name,
      description: `${name} description`,
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "",
      extensions: {},
    },
  };
}

function timestamp(index: number) {
  return `2026-05-12T12:${String(index).padStart(2, "0")}:00.000Z`;
}

function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeChatCompletion(res: ServerResponse, content: string) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("regenerating a hidden roleplay assistant message does not treat the target as missing", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;
  const capturedErrors: Error[] = [];

  try {
    await runMigrations(db);

    await db.insert(apiConnections).values({
      id: "conn-744",
      name: "Repro connection",
      provider: "custom",
      baseUrl: "http://127.0.0.1:9/v1",
      apiKeyEncrypted: "",
      model: "repro-model",
      maxContext: 4096,
      isDefault: "false",
      useForRandom: "false",
      enableCaching: "false",
      defaultForAgents: "false",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(characters).values({
      id: "char-744",
      data: JSON.stringify(buildCharacterData("char-744", "Rina")),
      comment: "",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(chats).values({
      id: "chat-744",
      name: "Hidden regen repro",
      mode: "roleplay",
      characterIds: JSON.stringify(["char-744"]),
      connectionId: "conn-744",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
    });

    const transcript = [
      { id: "m1", role: "user", content: "Setup one", extra: {} },
      { id: "m2", role: "assistant", content: "Reply one", extra: { hiddenFromAI: true } },
      { id: "m3", role: "user", content: "Setup two", extra: { hiddenFromAI: true } },
      { id: "m4", role: "assistant", content: "Reply two", extra: { hiddenFromAI: true } },
      { id: "target-hidden", role: "assistant", content: "Regenerate me", extra: { hiddenFromAI: true } },
    ] as const;

    for (let index = 0; index < transcript.length; index++) {
      const row = transcript[index]!;
      const createdAt = timestamp(index + 1);
      await db.insert(messages).values({
        id: row.id,
        chatId: "chat-744",
        role: row.role,
        characterId: row.role === "assistant" ? "char-744" : null,
        content: row.content,
        activeSwipeIndex: 0,
        extra: JSON.stringify(row.extra),
        createdAt,
      });
      await db.insert(messageSwipes).values({
        id: `swipe-${row.id}-0`,
        messageId: row.id,
        index: 0,
        content: row.content,
        extra: JSON.stringify(row.extra),
        createdAt,
      });
    }

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    app.setErrorHandler((err, _request, reply) => {
      capturedErrors.push(err);
      void reply.status(500).send({ error: err.message });
    });

    try {
      await app.register(generateRoutes, { prefix: "/api/generate" });
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/generate/",
        payload: {
          chatId: "chat-744",
          connectionId: "conn-744",
          userMessage: null,
          regenerateMessageId: "target-hidden",
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(capturedErrors.length, 0);
      assert.match(response.body, /"type":"progress"/);
      assert.match(response.body, /"type":"error"/);
      assert.doesNotMatch(response.body, /Regenerated message not found/);
      assert.doesNotMatch(response.body, /Reply was already sent/);
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});

test("smart group selector uses the configured Response Orchestrator connection and budget", async () => {
  const selectorRequests: Record<string, unknown>[] = [];
  const mainRequests: Record<string, unknown>[] = [];
  const selectorServer = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    selectorRequests.push(body);
    writeChatCompletion(res, JSON.stringify({ characterIds: ["char-alpha"], reason: "most relevant" }));
  });
  const mainServer = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    mainRequests.push(body);
    writeChatCompletion(res, "Alpha replies from the main model.");
  });
  const selectorUrl = await new Promise<string>((resolve, reject) => {
    selectorServer.once("error", reject);
    selectorServer.listen(0, "127.0.0.1", () => {
      const address = selectorServer.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
  const mainUrl = await new Promise<string>((resolve, reject) => {
    mainServer.once("error", reject);
    mainServer.listen(0, "127.0.0.1", () => {
      const address = mainServer.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(apiConnections).values([
      {
        id: "conn-main",
        name: "Main connection",
        provider: "custom",
        baseUrl: mainUrl,
        apiKeyEncrypted: "",
        model: "main-model",
        maxContext: 4096,
        isDefault: "false",
        useForRandom: "false",
        enableCaching: "false",
        defaultForAgents: "false",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "conn-orchestrator",
        name: "Orchestrator connection",
        provider: "custom",
        baseUrl: selectorUrl,
        apiKeyEncrypted: "",
        model: "orchestrator-model",
        maxContext: 4096,
        isDefault: "false",
        useForRandom: "false",
        enableCaching: "false",
        defaultForAgents: "false",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(agentConfigs).values({
      id: "agent-response-orchestrator",
      type: "response-orchestrator",
      name: "Response Orchestrator",
      description: "Selects group speakers",
      phase: "pre_generation",
      enabled: "true",
      connectionId: "conn-orchestrator",
      promptTemplate: "",
      settings: JSON.stringify({ maxTokens: 2048, temperature: 0.4 }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(characters).values([
      {
        id: "char-alpha",
        data: JSON.stringify(buildCharacterData("char-alpha", "Alpha")),
        comment: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "char-beta",
        data: JSON.stringify(buildCharacterData("char-beta", "Beta")),
        comment: "",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(chats).values({
      id: "chat-smart-selector",
      name: "Smart selector repro",
      mode: "roleplay",
      characterIds: JSON.stringify(["char-alpha", "char-beta"]),
      connectionId: "conn-main",
      metadata: JSON.stringify({
        enableAgents: true,
        activeAgentIds: [],
        groupChatMode: "individual",
        groupResponseOrder: "smart",
      }),
      createdAt: now,
      updatedAt: now,
    });

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(generateRoutes, { prefix: "/api/generate" });
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/generate/",
        payload: {
          chatId: "chat-smart-selector",
          connectionId: "conn-main",
          userMessage: "Who wants to answer this?",
          streaming: true,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(selectorRequests.length, 1);
      assert.equal(mainRequests.length, 1);
      assert.equal(selectorRequests[0]!.model, "orchestrator-model");
      assert.equal(selectorRequests[0]!.max_tokens, 2048);
      assert.equal(selectorRequests[0]!.temperature, 0.4);
      assert.equal(selectorRequests[0]!.stream, false);
      assert.equal(mainRequests[0]!.model, "main-model");
    } finally {
      await app.close();
    }
  } finally {
    client.close();
    await Promise.all([closeServer(selectorServer), closeServer(mainServer)]);
  }
});
