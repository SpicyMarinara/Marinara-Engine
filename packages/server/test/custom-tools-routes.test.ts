import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customToolsRoutes } from "../src/routes/custom-tools.routes.js";
import { createFileNativeDB } from "../src/db/file-backed-store.js";

type EnvPatch = Record<string, string | undefined>;

function withEnv<T>(patch: EnvPatch, fn: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function withCustomToolsApp<T>(fn: (app: ReturnType<typeof Fastify>) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "marinara-custom-tools-"));
  const previousStorageDir = process.env.FILE_STORAGE_DIR;
  process.env.FILE_STORAGE_DIR = join(root, "storage");

  const db = await createFileNativeDB();
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  await app.register(customToolsRoutes, { prefix: "/api/custom-tools" });
  await app.ready();

  try {
    return await fn(app);
  } finally {
    await app.close();
    await db._fileStore.close();
    if (previousStorageDir === undefined) {
      delete process.env.FILE_STORAGE_DIR;
    } else {
      process.env.FILE_STORAGE_DIR = previousStorageDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const scriptToolPayload = {
  name: "test_tool",
  description: "Test script tool",
  parametersSchema: { type: "object", properties: {} },
  executionType: "script",
  scriptBody: 'return { result: "ok" };',
  enabled: true,
};

test("custom tool capabilities expose whether script tools are enabled", async () =>
  withEnv({ CUSTOM_TOOL_SCRIPT_ENABLED: undefined }, () =>
    withCustomToolsApp(async (app) => {
      const res = await app.inject({ method: "GET", url: "/api/custom-tools/capabilities" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { scriptExecutionEnabled: false });
    }),
  ));

test("script custom tools are rejected when script execution is disabled", async () =>
  withEnv({ CUSTOM_TOOL_SCRIPT_ENABLED: undefined }, () =>
    withCustomToolsApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/custom-tools",
        payload: scriptToolPayload,
      });
      assert.equal(res.statusCode, 403);
      assert.match(res.json<{ error: string }>().error, /CUSTOM_TOOL_SCRIPT_ENABLED=true/);

      const list = await app.inject({ method: "GET", url: "/api/custom-tools" });
      assert.deepEqual(list.json(), []);
    }),
  ));

test("script custom tools stay enabled when script execution is explicitly enabled", async () =>
  withEnv({ CUSTOM_TOOL_SCRIPT_ENABLED: "true" }, () =>
    withCustomToolsApp(async (app) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/custom-tools",
        payload: scriptToolPayload,
      });
      assert.equal(res.statusCode, 200);
      const created = res.json<{ id: string; enabled: string; executionType: string }>();
      assert.equal(created.executionType, "script");
      assert.equal(created.enabled, "true");
    }),
  ));
