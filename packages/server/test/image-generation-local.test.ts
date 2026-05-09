import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { generateImage } from "../src/services/image/image-generation.js";
import { resolveConnectionImageDefaults } from "../src/services/image/image-generation-defaults.js";

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function readPngTextChunks(png: Buffer): Array<{ keyword: string; text: string }> {
  const chunks: Array<{ keyword: string; text: string }> = [];
  let offset = 8;
  while (offset < png.length) {
    const chunkLen = png.readUInt32BE(offset);
    const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkData = png.subarray(offset + 8, offset + 8 + chunkLen);
    if (chunkType === "tEXt") {
      const nullIdx = chunkData.indexOf(0);
      if (nullIdx > 0) {
        chunks.push({
          keyword: chunkData.subarray(0, nullIdx).toString("latin1"),
          text: chunkData.subarray(nullIdx + 1).toString("latin1"),
        });
      }
    } else if (chunkType === "iTXt") {
      const keywordEnd = chunkData.indexOf(0);
      if (keywordEnd > 0) {
        const languageTagStart = keywordEnd + 3;
        const languageTagEnd = chunkData.indexOf(0, languageTagStart);
        const translatedKeywordEnd = languageTagEnd >= 0 ? chunkData.indexOf(0, languageTagEnd + 1) : -1;
        if (translatedKeywordEnd >= 0) {
          chunks.push({
            keyword: chunkData.subarray(0, keywordEnd).toString("latin1"),
            text: chunkData.subarray(translatedKeywordEnd + 1).toString("utf8"),
          });
        }
      }
    }
    offset += 4 + 4 + chunkLen + 4;
  }
  return chunks;
}

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

test("native NovelAI image generation sends stable request settings and embeds metadata", async () => {
  const imageBytes = Buffer.from(PNG_1X1_BASE64, "base64");
  let capturedBody: Record<string, unknown> | null = null;
  let port = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/ai/generate-image")) {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        capturedBody = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { "content-type": "image/png" });
        res.end(imageBytes);
      });
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
    const imageDefaults = resolveConnectionImageDefaults({
      baseUrl: "https://image.novelai.net",
      model: "nai-diffusion-4-5-full",
      imageService: "novelai",
      defaultParameters: {
        imageGeneration: {
          version: 1,
          service: "novelai",
          seed: 12345,
          novelai: {
            promptPrefix: "best quality",
            negativePromptPrefix: "bad anatomy",
            sampler: "k_dpmpp_2m",
            noiseSchedule: "native",
            steps: 33,
            promptGuidance: 4.75,
            promptGuidanceRescale: 0.35,
            undesiredContentPreset: 2,
          },
        },
      },
    });

    const result = await generateImage(
      "novelai",
      `http://127.0.0.1:${port}/novelai.net`,
      "test-key",
      "novelai",
      {
        prompt: "cat cafe with 東京 neon",
        negativePrompt: "lowres, déjà vu",
        model: "nai-diffusion-4-5-full",
        width: 640,
        height: 960,
        imageDefaults,
        allowLocalUrls: true,
      },
    );

    const parameters = capturedBody?.parameters as Record<string, unknown>;
    assert.equal(capturedBody?.input, "best quality, cat cafe with 東京 neon");
    assert.equal(capturedBody?.model, "nai-diffusion-4-5-full");
    assert.equal(parameters.seed, 12345);
    assert.equal(parameters.steps, 33);
    assert.equal(parameters.scale, 4.75);
    assert.equal(parameters.cfg_rescale, 0.35);
    assert.equal(parameters.sampler, "k_dpmpp_2m");
    assert.equal(parameters.noise_schedule, "native");
    assert.equal(parameters.ucPreset, 2);
    assert.equal(parameters.negative_prompt, "bad anatomy, lowres, déjà vu");
    assert.deepEqual((parameters.v4_prompt as Record<string, unknown>).caption, {
      base_caption: "best quality, cat cafe with 東京 neon",
      char_captions: [],
    });
    assert.deepEqual((parameters.v4_negative_prompt as Record<string, unknown>).caption, {
      base_caption: "bad anatomy, lowres, déjà vu",
      char_captions: [],
    });

    const output = Buffer.from(result.base64, "base64");
    const requestMetadata = readPngTextChunks(output).find((chunk) => chunk.keyword === "marinara_novelai_request");
    assert.ok(requestMetadata);
    const metadata = JSON.parse(requestMetadata.text) as { request: Record<string, unknown> };
    assert.deepEqual(metadata.request, capturedBody);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("native NovelAI image generation keeps V3 prompt shape", async () => {
  const imageBytes = Buffer.from(PNG_1X1_BASE64, "base64");
  let capturedBody: Record<string, unknown> | null = null;
  let port = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/ai/generate-image")) {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        capturedBody = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { "content-type": "image/png" });
        res.end(imageBytes);
      });
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
    await generateImage(
      "novelai",
      `http://127.0.0.1:${port}/novelai.net`,
      "test-key",
      "novelai",
      {
        prompt: "cat cafe",
        negativePrompt: "lowres",
        model: "nai-diffusion-3",
        width: 640,
        height: 960,
        allowLocalUrls: true,
      },
    );

    const parameters = capturedBody?.parameters as Record<string, unknown>;
    assert.equal(capturedBody?.input, "cat cafe");
    assert.equal(capturedBody?.model, "nai-diffusion-3");
    assert.equal(parameters.negative_prompt, "lowres");
    assert.equal(parameters.params_version, undefined);
    assert.equal(parameters.v4_prompt, undefined);
    assert.equal(parameters.v4_negative_prompt, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
