import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import { isRuntimeInstallRequestAllowed } from "../src/routes/sidecar.routes.js";

type EnvPatch = Record<string, string | undefined>;

function withEnv<T>(patch: EnvPatch, fn: () => T | Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function makeRequest(adminSecret?: string): FastifyRequest {
  return {
    headers: adminSecret ? { "x-admin-secret": adminSecret } : {},
  } as unknown as FastifyRequest;
}

test("sidecar runtime install stays disabled without feature flag or explicit admin secret", async () =>
  withEnv({ SIDECAR_RUNTIME_INSTALL_ENABLED: undefined, ADMIN_SECRET: "secret" }, () => {
    assert.equal(isRuntimeInstallRequestAllowed(makeRequest()), false);
  }));

test("sidecar runtime install allows an explicit valid admin secret", async () =>
  withEnv({ SIDECAR_RUNTIME_INSTALL_ENABLED: undefined, ADMIN_SECRET: "secret" }, () => {
    assert.equal(isRuntimeInstallRequestAllowed(makeRequest("secret")), true);
  }));

test("sidecar runtime install feature flag still enables loopback setup flows", async () =>
  withEnv({ SIDECAR_RUNTIME_INSTALL_ENABLED: "true", ADMIN_SECRET: undefined }, () => {
    assert.equal(isRuntimeInstallRequestAllowed(makeRequest()), true);
  }));
