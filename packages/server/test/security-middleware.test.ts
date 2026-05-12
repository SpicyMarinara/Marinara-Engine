import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@marinara-engine/shared";
import { basicAuthHook } from "../src/middleware/basic-auth.js";
import { csrfProtectionHook } from "../src/middleware/csrf-protection.js";
import { requirePrivilegedAccess } from "../src/middleware/privileged-gate.js";
import { rateLimitHook, resetRateLimitBucketsForTests } from "../src/middleware/rate-limit.js";
import { securityHeadersHook } from "../src/middleware/security-headers.js";

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

async function buildHookApp() {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", securityHeadersHook);
  app.addHook("onRequest", rateLimitHook);
  app.addHook("onRequest", basicAuthHook);
  app.addHook("onRequest", csrfProtectionHook);

  app.post("/api/mutate", async () => ({ ok: true }));
  app.post("/api/adminish", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Test admin" })) return;
    return { ok: true };
  });
  app.get("/api/headers", async () => ({ ok: true }));
  app.post("/api/haptic/command", async () => ({ ok: true }));
  app.get("/", async () => "ok");
  await app.ready();
  return app;
}

test("non-loopback requests fail closed when Basic Auth is not configured", async () =>
  withEnv(
    {
      BASIC_AUTH_USER: undefined,
      BASIC_AUTH_PASS: undefined,
      ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: undefined,
      ALLOW_UNAUTHENTICATED_REMOTE: undefined,
      IP_ALLOWLIST: undefined,
    },
    async () => {
      const app = await buildHookApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: "/api/headers",
          remoteAddress: "192.168.1.50",
        });
        assert.equal(res.statusCode, 403);
      } finally {
        await app.close();
      }
    },
  ));

test("browser navigation hitting the lockdown gets the friendly HTML page", async () =>
  withEnv(
    {
      BASIC_AUTH_USER: undefined,
      BASIC_AUTH_PASS: undefined,
      ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: undefined,
      ALLOW_UNAUTHENTICATED_REMOTE: undefined,
      IP_ALLOWLIST: undefined,
    },
    async () => {
      const app = await buildHookApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: "/",
          remoteAddress: "192.168.1.50",
          headers: { accept: "text/html,application/xhtml+xml" },
        });
        assert.equal(res.statusCode, 403);
        assert.match(res.headers["content-type"] ?? "", /text\/html/);
        assert.match(res.body, /<!doctype html>/i);
        assert.match(res.body, /BASIC_AUTH_USER/);
        assert.match(res.body, /IP_ALLOWLIST=192\.168\.1\.50/);
      } finally {
        await app.close();
      }
    },
  ));

test("non-browser clients still get JSON 403 from the lockdown", async () =>
  withEnv(
    {
      BASIC_AUTH_USER: undefined,
      BASIC_AUTH_PASS: undefined,
      ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: undefined,
      ALLOW_UNAUTHENTICATED_REMOTE: undefined,
      IP_ALLOWLIST: undefined,
    },
    async () => {
      const app = await buildHookApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: "/api/headers",
          remoteAddress: "192.168.1.50",
          headers: { accept: "application/json" },
        });
        assert.equal(res.statusCode, 403);
        assert.match(res.headers["content-type"] ?? "", /application\/json/);
        const body = JSON.parse(res.body) as { error: string };
        assert.equal(body.error, "Forbidden");
      } finally {
        await app.close();
      }
    },
  ));

test("Basic Auth credentials satisfy non-loopback access", async () =>
  withEnv(
    {
      BASIC_AUTH_USER: "admin",
      BASIC_AUTH_PASS: "secret",
      IP_ALLOWLIST: undefined,
    },
    async () => {
      const app = await buildHookApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: "/api/headers",
          remoteAddress: "192.168.1.50",
          headers: { authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}` },
        });
        assert.equal(res.statusCode, 200);
      } finally {
        await app.close();
      }
    },
  ));

test("CSRF protection blocks cross-site unsafe API requests", async () =>
  withEnv({}, async () => {
    const app = await buildHookApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      });
      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body) as { code?: string };
      assert.equal(body.code, "CSRF_CROSS_SITE");
    } finally {
      await app.close();
    }
  }));

test("CSRF 403 body carries a stable code field clients can detect", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const originReject = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "http://71.175.221.189:7831",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(originReject.statusCode, 403);
      const originBody = JSON.parse(originReject.body) as { code?: string; origin?: string; hint?: string };
      assert.equal(originBody.code, "CSRF_ORIGIN_NOT_TRUSTED");
      assert.equal(originBody.origin, "http://71.175.221.189:7831");
      assert.match(originBody.hint ?? "", /CSRF_TRUSTED_ORIGINS/);

      const refererReject = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          referer: "http://71.175.221.189:7831/chat",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(refererReject.statusCode, 403);
      const refererBody = JSON.parse(refererReject.body) as { code?: string };
      assert.equal(refererBody.code, "CSRF_REFERER_NOT_TRUSTED");

      const missingHeader = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "http://127.0.0.1:7860",
          "sec-fetch-site": "same-site",
        },
      });
      assert.equal(missingHeader.statusCode, 403);
      const missingBody = JSON.parse(missingHeader.body) as { code?: string };
      assert.equal(missingBody.code, "CSRF_MISSING_HEADER");
    } finally {
      await app.close();
    }
  }));

test("/api/csrf/origin-status reports loopback as trusted", async () =>
  withEnv({}, async () => {
    const Fastify = (await import("fastify")).default;
    const { csrfDiagnosticsRoutes } = await import("../src/routes/csrf-diagnostics.routes.js");
    const app = Fastify({ logger: false });
    await app.register(csrfDiagnosticsRoutes, { prefix: "/api/csrf" });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/csrf/origin-status",
        remoteAddress: "127.0.0.1",
        headers: { host: "127.0.0.1:7860", origin: "http://127.0.0.1:7860" },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as { trusted: boolean; code: string | null };
      assert.equal(body.trusted, true);
      assert.equal(body.code, null);
    } finally {
      await app.close();
    }
  }));

test("/api/csrf/origin-status reports public-IP origins as untrusted with a hint", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: undefined }, async () => {
    const Fastify = (await import("fastify")).default;
    const { csrfDiagnosticsRoutes } = await import("../src/routes/csrf-diagnostics.routes.js");
    const app = Fastify({ logger: false });
    await app.register(csrfDiagnosticsRoutes, { prefix: "/api/csrf" });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/csrf/origin-status",
        remoteAddress: "127.0.0.1",
        headers: { host: "127.0.0.1:7860", origin: "http://71.175.221.189:7831" },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as {
        trusted: boolean;
        origin: string;
        source: string;
        code: string | null;
        hint: string | null;
      };
      assert.equal(body.trusted, false);
      assert.equal(body.origin, "http://71.175.221.189:7831");
      assert.equal(body.source, "origin");
      assert.equal(body.code, "CSRF_ORIGIN_NOT_TRUSTED");
      assert.match(body.hint ?? "", /CSRF_TRUSTED_ORIGINS=.*71\.175\.221\.189:7831/);
    } finally {
      await app.close();
    }
  }));

test("/api/csrf/origin-status reports trusted once the origin is in CSRF_TRUSTED_ORIGINS", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: "http://71.175.221.189:7831" }, async () => {
    const Fastify = (await import("fastify")).default;
    const { csrfDiagnosticsRoutes } = await import("../src/routes/csrf-diagnostics.routes.js");
    const app = Fastify({ logger: false });
    await app.register(csrfDiagnosticsRoutes, { prefix: "/api/csrf" });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/csrf/origin-status",
        remoteAddress: "127.0.0.1",
        headers: { host: "71.175.221.189:7831", origin: "http://71.175.221.189:7831" },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as { trusted: boolean; code: string | null };
      assert.equal(body.trusted, true);
      assert.equal(body.code, null);
    } finally {
      await app.close();
    }
  }));

test("CSRF_TRUSTED_ORIGINS accepts a comma-separated list of origins", async () =>
  withEnv(
    {
      CSRF_TRUSTED_ORIGINS: "http://71.175.221.189:7831, https://chat.example.test, http://my-host.tail-scale.ts.net:7860",
    },
    async () => {
      const app = await buildHookApp();
      try {
        for (const origin of [
          "http://71.175.221.189:7831",
          "https://chat.example.test",
          "http://my-host.tail-scale.ts.net:7860",
        ]) {
          const res = await app.inject({
            method: "POST",
            url: "/api/mutate",
            remoteAddress: "127.0.0.1",
            headers: {
              host: new URL(origin).host,
              origin,
              "x-forwarded-proto": new URL(origin).protocol === "https:" ? "https" : "http",
              [CSRF_HEADER]: CSRF_HEADER_VALUE,
            },
          });
          assert.equal(res.statusCode, 200, `origin ${origin} should be accepted`);
        }
      } finally {
        await app.close();
      }
    },
  ));

test("same-origin unsafe API requests allow stale clients without the CSRF header", async () =>
  withEnv({}, async () => {
    const app = await buildHookApp();
    try {
      const staleClient = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "http://127.0.0.1:7860",
          "sec-fetch-site": "same-origin",
        },
      });
      assert.equal(staleClient.statusCode, 200);

      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "http://127.0.0.1:7860",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("same-site unsafe API requests still require the CSRF header", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: "http://app.example.test" }, async () => {
    const app = await buildHookApp();
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "app.example.test",
          origin: "http://app.example.test",
          "sec-fetch-site": "same-site",
        },
      });
      assert.equal(missing.statusCode, 403);

      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "app.example.test",
          origin: "http://app.example.test",
          "sec-fetch-site": "same-site",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("trusted cross-origin unsafe API requests without fetch metadata require the CSRF header", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: "https://trusted.example.test" }, async () => {
    const app = await buildHookApp();
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "https://trusted.example.test",
        },
      });
      assert.equal(missing.statusCode, 403);

      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "https://trusted.example.test",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection allows configured reverse proxy HTTPS origins", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: "https://chat.example.test" }, async () => {
    const app = await buildHookApp();
    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "chat.example.test",
          origin: "https://chat.example.test",
          "x-forwarded-proto": "https",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection allows private literal network origins with the CSRF header", async () =>
  withEnv({ ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true", IP_ALLOWLIST: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "192.168.1.50",
        headers: {
          host: "192.168.1.10:7860",
          origin: "http://192.168.1.10:7860",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);

      const tailscale = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "100.64.1.50",
        headers: {
          host: "100.64.1.10:7860",
          origin: "http://100.64.1.10:7860",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(tailscale.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection allows private literal Docker host-port origins", async () =>
  withEnv({ ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true", IP_ALLOWLIST: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "192.168.1.50",
        headers: {
          host: "192.168.1.10:3004",
          origin: "http://192.168.1.10:3004",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection allows explicit wildcard trusted origins with the CSRF header", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: "*" }, async () => {
    const app = await buildHookApp();
    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "127.0.0.1:7860",
          origin: "https://trusted-by-wildcard.example",
          "sec-fetch-site": "cross-site",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection still rejects private-network DNS rebinding-style origins", async () =>
  withEnv({ ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true", IP_ALLOWLIST: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "192.168.1.50",
        headers: {
          host: "evil.example:7860",
          origin: "http://evil.example:7860",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(res.statusCode, 403);
    } finally {
      await app.close();
    }
  }));

test("CSRF protection does not trust Host as an origin allowlist", async () =>
  withEnv({ CSRF_TRUSTED_ORIGINS: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/mutate",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "evil.example",
          origin: "https://evil.example",
          "sec-fetch-site": "same-origin",
          [CSRF_HEADER]: CSRF_HEADER_VALUE,
        },
      });
      assert.equal(res.statusCode, 403);
    } finally {
      await app.close();
    }
  }));

test("privileged gate requires ADMIN_SECRET", async () =>
  withEnv(
    { ADMIN_SECRET: "top-secret", ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK: "true", IP_ALLOWLIST: undefined },
    async () => {
      const app = await buildHookApp();
      try {
        const missing = await app.inject({
          method: "POST",
          url: "/api/adminish",
          remoteAddress: "192.168.1.50",
          headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
        });
        assert.equal(missing.statusCode, 403);

        const allowed = await app.inject({
          method: "POST",
          url: "/api/adminish",
          remoteAddress: "192.168.1.50",
          headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, "x-admin-secret": "top-secret" },
        });
        assert.equal(allowed.statusCode, 200);
      } finally {
        await app.close();
      }
    },
  ));

test("privileged gate allows loopback without ADMIN_SECRET by default", async () =>
  withEnv({ ADMIN_SECRET: undefined, MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK: undefined }, async () => {
    const app = await buildHookApp();
    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/api/adminish",
        remoteAddress: "127.0.0.1",
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("privileged gate can require ADMIN_SECRET on loopback", async () =>
  withEnv({ ADMIN_SECRET: "top-secret", MARINARA_REQUIRE_ADMIN_SECRET_ON_LOOPBACK: "true" }, async () => {
    const app = await buildHookApp();
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/api/adminish",
        remoteAddress: "127.0.0.1",
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      });
      assert.equal(missing.statusCode, 403);

      const allowed = await app.inject({
        method: "POST",
        url: "/api/adminish",
        remoteAddress: "127.0.0.1",
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, "x-admin-secret": "top-secret" },
      });
      assert.equal(allowed.statusCode, 200);
    } finally {
      await app.close();
    }
  }));

test("security headers and route rate limits are applied", async () =>
  withEnv({}, async () => {
    resetRateLimitBucketsForTests();
    const app = await buildHookApp();
    try {
      const headers = await app.inject({ method: "GET", url: "/api/headers", remoteAddress: "127.0.0.1" });
      assert.equal(headers.headers["x-content-type-options"], "nosniff");
      const csp = String(headers.headers["content-security-policy"]);
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' blob: https:\/\/sdk\.scdn\.co/);
      assert.match(csp, /media-src 'self' blob: https:/);
      assert.match(csp, /frame-src 'self' https:\/\/sdk\.scdn\.co https:\/\/accounts\.spotify\.com/);
      assert.doesNotMatch(csp, /unsafe-eval/);

      let lastStatus = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await app.inject({
          method: "POST",
          url: "/api/haptic/command",
          remoteAddress: "127.0.0.1",
          headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
        });
        lastStatus = res.statusCode;
      }
      assert.equal(lastStatus, 429);
    } finally {
      await app.close();
      resetRateLimitBucketsForTests();
    }
  }));
