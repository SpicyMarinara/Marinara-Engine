import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { generateImage } from "../src/services/image/image-generation.js";

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("local OpenAI-compatible image generation normalizes localhost URLs", async () => {
  const imageBytes = Buffer.from(PNG_1X1_BASE64, "base64");
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === "/v1/images/generations") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: `http://localhost:${port}/image.png` }] }));
      return;
    }

    if (req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(imageBytes);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addressInfo = server.address();
  assert.ok(addressInfo && typeof addressInfo === "object");
  port = addressInfo.port;

  try {
    const result = await generateImage("nanogpt", `http://localhost:${port}/api/v1`, "test-key", "nanogpt", {
      prompt: "test",
      width: 512,
      height: 512,
    });

    assert.equal(result.mimeType, "image/png");
    assert.equal(result.base64, PNG_1X1_BASE64);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
