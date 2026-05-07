import test from "node:test";
import assert from "node:assert/strict";
import { promises as dns } from "node:dns";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, win32 } from "node:path";
import { tmpdir } from "node:os";
import {
  assertInsideDir,
  isAllowedImageBuffer,
  normalizeLoopbackUrl,
  safeFetch,
  validateOutboundUrl,
} from "../src/utils/security.js";

test("assertInsideDir rejects sibling prefix escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "marinara-sec-root-"));
  const sibling = `${root}-sibling`;
  try {
    assert.equal(assertInsideDir(root, join(root, "avatars", "a.png")), resolve(root, "avatars", "a.png"));
    assert.throws(() => assertInsideDir(root, join(sibling, "a.png")), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assertInsideDir rejects Windows cross-drive escapes", () => {
  assert.throws(() => assertInsideDir("C:\\marinara\\data", "D:\\marinara\\data\\avatars\\a.png"), /escapes/);
  assert.equal(
    assertInsideDir("C:\\marinara\\data", "C:\\marinara\\data\\avatars\\a.png"),
    win32.resolve("C:\\marinara\\data\\avatars\\a.png"),
  );
});

test("image magic byte validation rejects SVG masquerading as PNG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const svg = Buffer.from('<svg onload="alert(1)"></svg>');
  assert.equal(isAllowedImageBuffer(png, ".png")?.mimeType, "image/png");
  assert.equal(isAllowedImageBuffer(svg, ".png"), null);
});

test("AVIF validation requires an AVIF-compatible ftyp brand", () => {
  const avif = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypavif", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("mif1avif", "ascii"),
  ]);
  const heic = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypheic", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("mif1heic", "ascii"),
  ]);

  assert.equal(isAllowedImageBuffer(avif, ".avif")?.mimeType, "image/avif");
  assert.equal(isAllowedImageBuffer(heic, ".avif"), null);
});

test("normalizeLoopbackUrl maps localhost names to IPv4 loopback", () => {
  assert.equal(normalizeLoopbackUrl("http://localhost:8188/object_info"), "http://127.0.0.1:8188/object_info");
  assert.equal(normalizeLoopbackUrl("http://localhost.localdomain:7860"), "http://127.0.0.1:7860/");
  assert.equal(normalizeLoopbackUrl("http://127.0.0.1:7860"), "http://127.0.0.1:7860/");
});

test("validateOutboundUrl rejects local/private/metadata destinations", async () => {
  await assert.rejects(() => validateOutboundUrl("http://127.0.0.1:7860", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://localhost:7860", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://[::1]:7860", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://10.0.0.1", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://192.168.1.1", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://169.254.169.254", { allowedProtocols: ["http:", "https:"] }));
});

test("validateOutboundUrl allows explicit local-provider mode", async () => {
  const parsed = await validateOutboundUrl("http://127.0.0.1:8188", {
    allowLocal: true,
    allowedProtocols: ["http:", "https:"],
  });
  assert.equal(parsed.hostname, "127.0.0.1");
});

test("validateOutboundUrl allows loopback-only provider mode", async () => {
  const policy = { allowLoopback: true, allowedProtocols: ["http:", "https:"] };
  assert.equal((await validateOutboundUrl("http://127.0.0.1:8188", policy)).hostname, "127.0.0.1");
  assert.equal((await validateOutboundUrl("http://localhost:8188", policy)).hostname, "localhost");
  assert.equal((await validateOutboundUrl("http://[::1]:8188", policy)).hostname, "[::1]");
  await assert.rejects(() => validateOutboundUrl("http://10.0.0.1:8188", policy));
  await assert.rejects(() => validateOutboundUrl("http://169.254.169.254", policy));
  await assert.rejects(() => validateOutboundUrl("http://example.localhost:8188", policy));
});

test("validateOutboundUrl allows explicit mDNS provider mode", async () => {
  const originalLookup = dns.lookup;
  dns.lookup = (async (hostname: string) => {
    if (hostname === "name.local") return [{ address: "192.168.1.50", family: 4 }];
    return originalLookup(hostname, { all: true, verbatim: true } as never) as never;
  }) as typeof dns.lookup;

  try {
    const parsed = await validateOutboundUrl("http://name.local:5001/v1", {
      allowLoopback: true,
      allowMdns: true,
      allowedProtocols: ["http:", "https:"],
    });
    assert.equal(parsed.hostname, "name.local");

    await assert.rejects(
      () => validateOutboundUrl("http://name.local:5001/v1", { allowedProtocols: ["http:", "https:"] }),
      /local or reserved/,
    );
  } finally {
    dns.lookup = originalLookup;
  }
});

test("validateOutboundUrl rejects empty mDNS resolution results", async () => {
  const originalLookup = dns.lookup;
  dns.lookup = (async (hostname: string) => {
    if (hostname === "empty.local") return [];
    return originalLookup(hostname, { all: true, verbatim: true } as never) as never;
  }) as typeof dns.lookup;

  try {
    await assert.rejects(
      () =>
        validateOutboundUrl("http://empty.local:5001/v1", {
          allowLoopback: true,
          allowMdns: true,
          allowedProtocols: ["http:", "https:"],
        }),
      /hostname 'empty\.local' did not resolve to any address/,
    );
  } finally {
    dns.lookup = originalLookup;
  }
});

test("validateOutboundUrl allows public IPv4 destinations", async () => {
  const parsed = await validateOutboundUrl("https://8.8.8.8/dns-query");
  assert.equal(parsed.hostname, "8.8.8.8");
});

test("safeFetch rejects DNS rebinding before the outbound connection", async () => {
  const originalLookup = dns.lookup;
  let calls = 0;
  dns.lookup = (async () => {
    calls += 1;
    return [{ address: calls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
  }) as typeof dns.lookup;

  try {
    await assert.rejects(
      () => safeFetch("https://rebind.example.test/image.png", { allowedContentTypes: ["image/"] }),
      /private, loopback, metadata, or reserved/,
    );
    assert.equal(calls, 2);
  } finally {
    dns.lookup = originalLookup;
  }
});

test("safeFetch can return a streaming capped response without buffering", async () => {
  const response = await safeFetch("https://example.com/stream", {
    bufferResponse: false,
    policy: { allowLocal: true },
    dispatcher: {
      dispatch(
        _options: unknown,
        handler: {
          onConnect: (abort: () => void) => void;
          onHeaders: (status: number, headers: string[], resume: () => void) => void;
          onData: (chunk: Buffer) => void;
          onComplete: (trailers: string[]) => void;
        },
      ) {
        handler.onConnect(() => undefined);
        handler.onHeaders(200, ["content-type", "text/plain"], () => undefined);
        setTimeout(() => {
          handler.onData(Buffer.from("hello"));
          handler.onComplete([]);
        }, 20);
        return true;
      },
    },
  });

  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.equal(Buffer.from(first.value ?? []).toString("utf8"), "hello");
});

test("safeFetch rejects missing content-type when a content gate is configured", async () => {
  await assert.rejects(
    () =>
      safeFetch("https://example.com/no-content-type", {
        policy: { allowLocal: true },
        allowedContentTypes: ["image/"],
        dispatcher: {
          dispatch(
            _options: unknown,
            handler: {
              onConnect: (abort: () => void) => void;
              onHeaders: (status: number, headers: string[], resume: () => void) => void;
              onComplete: (trailers: string[]) => void;
            },
          ) {
            handler.onConnect(() => undefined);
            handler.onHeaders(200, [], () => undefined);
            handler.onComplete([]);
            return true;
          },
        },
      }),
    /content type is not allowed/,
  );
});
