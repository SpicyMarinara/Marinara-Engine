import test from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TTS_SETTINGS_KEY } from "@marinara-engine/shared";
import { createFileNativeDB } from "../src/db/file-backed-store.js";
import { createAppSettingsStorage } from "../src/services/storage/app-settings.storage.js";

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

async function withAdminApp<T>(fn: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "marinara-admin-routes-"));

  return withEnv(
    {
      ADMIN_SECRET: undefined,
      DATA_DIR: join(root, "data"),
      FILE_STORAGE_DIR: join(root, "storage"),
      MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK: undefined,
    },
    async () => {
      const { adminRoutes } = await import("../src/routes/admin.routes.js");
      const db = await createFileNativeDB();
      const app = Fastify({ logger: false });
      app.decorate("db", db);
      await app.register(adminRoutes, { prefix: "/api/admin" });
      await app.ready();

      try {
        return await fn(app);
      } finally {
        await app.close();
        await db._fileStore.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

test("clearing connections removes saved TTS settings", async () =>
  withAdminApp(async (app) => {
    const settings = createAppSettingsStorage(app.db);
    const savedTtsConfig = JSON.stringify({
      enabled: true,
      source: "openai",
      apiKey: "encrypted-test-key",
    });

    await settings.set(TTS_SETTINGS_KEY, savedTtsConfig);
    const expunge = await app.inject({
      method: "POST",
      url: "/api/admin/expunge",
      remoteAddress: "127.0.0.1",
      payload: { confirm: true, scopes: ["connections"] },
    });

    assert.equal(expunge.statusCode, 200, expunge.body);
    assert.equal(await settings.get(TTS_SETTINGS_KEY), null);

    await settings.set(TTS_SETTINGS_KEY, savedTtsConfig);
    const clearAll = await app.inject({
      method: "POST",
      url: "/api/admin/clear-all",
      remoteAddress: "127.0.0.1",
      payload: { confirm: true },
    });

    assert.equal(clearAll.statusCode, 200, clearAll.body);
    assert.equal(await settings.get(TTS_SETTINGS_KEY), null);
  }));
