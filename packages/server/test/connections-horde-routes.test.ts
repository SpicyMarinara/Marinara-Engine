import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Fastify from "fastify";
import { connectionsRoutes } from "../src/routes/connections.routes.js";

function createMockDb(baseUrl: string) {
  const connection = {
    id: "conn-horde",
    name: "Horde",
    provider: "image_generation",
    baseUrl,
    apiKeyEncrypted: "",
    apiKey: "test-key",
    model: "",
    maxContext: 0,
    isDefault: "false",
    useForRandom: "false",
    defaultForAgents: "false",
    enableCaching: "false",
    cachingAtDepth: 5,
    embeddingModel: "",
    embeddingBaseUrl: "",
    embeddingConnectionId: null,
    openrouterProvider: null,
    imageGenerationSource: "horde",
    comfyuiWorkflow: null,
    imageService: "horde",
    defaultParameters: null,
    maxTokensOverride: null,
    maxParallelJobs: 1,
    claudeFastMode: "false",
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
  };

  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve([connection]);
            },
          };
        },
      };
    },
  };
}

async function withHordeServer(run: (baseUrl: string, requests: string[]) => Promise<void>) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/api/v2/status/heartbeat") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v2/status/models?type=image") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ name: "stable_diffusion" }, { name: "flux" }]));
      return;
    }

    res.writeHead(404, { "content-type": "text/html" });
    res.end("<!doctype html><title>404 Not Found</title>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}/api/v2`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("Horde connection test uses the heartbeat endpoint", async () => {
  await withHordeServer(async (baseUrl, requests) => {
    const app = Fastify({ logger: false });
    app.decorate("db", createMockDb(baseUrl));
    try {
      await app.register(connectionsRoutes, { prefix: "/api/connections" });
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/connections/conn-horde/test" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json<{ success: boolean }>().success, true);
      assert.deepEqual(requests, ["GET /api/v2/status/heartbeat"]);
    } finally {
      await app.close();
    }
  });
});

test("Horde model fetch uses the image status models endpoint", async () => {
  await withHordeServer(async (baseUrl, requests) => {
    const app = Fastify({ logger: false });
    app.decorate("db", createMockDb(baseUrl));
    try {
      await app.register(connectionsRoutes, { prefix: "/api/connections" });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/connections/conn-horde/models" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json<{ models: Array<{ id: string; name: string }> }>().models, [
        { id: "stable_diffusion", name: "stable_diffusion" },
        { id: "flux", name: "flux" },
      ]);
      assert.deepEqual(requests, ["GET /api/v2/status/models?type=image"]);
    } finally {
      await app.close();
    }
  });
});
