import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertInsideDir, isAllowedImageBuffer, validateOutboundUrl } from "../src/utils/security.js";

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

test("image magic byte validation rejects SVG masquerading as PNG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const svg = Buffer.from('<svg onload="alert(1)"></svg>');
  assert.equal(isAllowedImageBuffer(png, ".png")?.mimeType, "image/png");
  assert.equal(isAllowedImageBuffer(svg, ".png"), null);
});

test("validateOutboundUrl rejects local/private/metadata destinations", async () => {
  await assert.rejects(() => validateOutboundUrl("http://127.0.0.1:7860", { allowedProtocols: ["http:", "https:"] }));
  await assert.rejects(() => validateOutboundUrl("http://localhost:7860", { allowedProtocols: ["http:", "https:"] }));
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
