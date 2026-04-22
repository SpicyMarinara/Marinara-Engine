// ──────────────────────────────────────────────
// Routes: Character Sprite Upload, List & Serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, createReadStream, readdirSync, unlinkSync, statSync, readFileSync } from "fs";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import { join, extname } from "path";
import { DATA_DIR } from "../utils/data-dir.js";

// sharp is an optional dependency — native prebuilds don't exist for all platforms
// (e.g. Android/Termux). Lazy-load so the server boots even when sharp is missing;
// sprite-generation routes will return a clear error instead of crashing the process.
// We intentionally avoid `import type` from "sharp" so tsc succeeds on platforms
// where the package isn't installed at all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = any;
let _sharp: SharpFn | null = null;
let _sharpLoadError: Error | null = null;
async function getSharp(): Promise<SharpFn> {
  if (_sharp) return _sharp;
  if (_sharpLoadError) throw _sharpLoadError;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dep, may not be installed on some platforms
    const mod = await import("sharp");
    _sharp = (mod.default ?? mod) as SharpFn;
    return _sharp;
  } catch {
    _sharpLoadError = new Error(
      "Image processing is unavailable on this platform (native 'sharp' module could not be loaded). " +
        "Sprite generation and background removal are disabled.",
    );
    throw _sharpLoadError;
  }
}

async function getSpriteCapabilities() {
  try {
    await getSharp();
    return {
      imageProcessingAvailable: true,
      spriteGenerationAvailable: true,
      backgroundRemovalAvailable: true,
      reason: null as string | null,
    };
  } catch (error) {
    return {
      imageProcessingAvailable: false,
      spriteGenerationAvailable: false,
      backgroundRemovalAvailable: false,
      reason: error instanceof Error ? error.message : "Image processing is unavailable on this platform.",
    };
  }
}
import { generateImage } from "../services/image/image-generation.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";

const SPRITES_ROOT = join(DATA_DIR, "sprites");

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Convert near-white background pixels to transparency.
 * This works best when the model renders on a solid white backdrop.
 */
async function removeNearWhiteBackgroundPng(input: Buffer, cleanupStrength = 50): Promise<Buffer> {
  const sharp = await getSharp();
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    return sharp(input).png().toBuffer();
  }

  const rgba = Buffer.from(data);
  const channels = info.channels;
  const strength = Math.max(0, Math.min(100, cleanupStrength));

  // 0 = very soft, 100 = very aggressive
  // Keep the low end conservative so strength=0 only removes almost-pure white.
  const hardCutoff = Math.round(1 + (strength / 100) * 7); // 1..8
  const fadeWindow = Math.round(6 + (strength / 100) * 24); // 6..30
  const softCutoff = hardCutoff + fadeWindow;

  // Extra guards to avoid deleting light skin/highlights:
  // - Only affect very bright pixels (high min channel)
  // - Only affect near-neutral pixels (small RGB channel spread)
  const minChannelFloor = Math.round(242 + (strength / 100) * 8); // 242..250
  const spreadHardLimit = Math.round(5 + (strength / 100) * 8); // 5..13
  const spreadSoftWindow = 10;
  const spreadSoftLimit = spreadHardLimit + spreadSoftWindow;

  for (let i = 0; i < rgba.length; i += channels) {
    const r = rgba[i] ?? 255;
    const g = rgba[i + 1] ?? 255;
    const b = rgba[i + 2] ?? 255;
    const a = rgba[i + 3] ?? 255;

    const minChannel = Math.min(r, g, b);
    const maxChannel = Math.max(r, g, b);
    const spread = maxChannel - minChannel;

    // Skip colored / not-bright-enough pixels entirely.
    if (minChannel < minChannelFloor || spread > spreadSoftLimit) {
      continue;
    }

    // Use Euclidean distance from pure white (255,255,255) once the neutral+bright guards pass.
    const distanceFromWhite = Math.sqrt((255 - r) * (255 - r) + (255 - g) * (255 - g) + (255 - b) * (255 - b));

    let alphaFactor = 1;

    if (spread > spreadHardLimit) {
      const spreadT = (spread - spreadHardLimit) / Math.max(1, spreadSoftWindow);
      alphaFactor *= 1 - Math.max(0, Math.min(1, spreadT));
    }

    if (distanceFromWhite <= hardCutoff) {
      rgba[i + 3] = Math.max(0, Math.min(a, Math.round(a * (1 - alphaFactor))));
      continue;
    }

    if (distanceFromWhite <= softCutoff) {
      const t = (distanceFromWhite - hardCutoff) / Math.max(1, fadeWindow);
      const keep = Math.max(0, Math.min(1, t));
      rgba[i + 3] = Math.max(0, Math.min(a, Math.round(a * (keep + (1 - keep) * (1 - alphaFactor)))));
    }
  }

  return sharp(rgba, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length < 32) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
}

function extractBase64ImageData(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0) return "";
    return trimmed.slice(comma + 1);
  }

  return trimmed;
}

/** Accepts data URL, raw base64, or /api/avatars/file/<filename> URL and returns base64 if resolvable. */
function resolveReferenceImageBase64(input?: string): string | undefined {
  if (!input?.trim()) return undefined;
  const value = input.trim();

  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0) return undefined;
    const b64 = value.slice(comma + 1);
    return looksLikeBase64(b64) ? b64 : undefined;
  }

  if (value.startsWith("/api/avatars/file/")) {
    const filenameRaw = value.split("/").pop()?.split("?")[0];
    if (!filenameRaw) return undefined;
    const filename = decodeURIComponent(filenameRaw);
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return undefined;
    const diskPath = join(DATA_DIR, "avatars", filename);
    try {
      if (!existsSync(diskPath)) return undefined;
      return readFileSync(diskPath).toString("base64");
    } catch {
      return undefined;
    }
  }

  if (looksLikeBase64(value)) return value;
  return undefined;
}

export async function spritesRoutes(app: FastifyInstance) {
  app.get("/capabilities", async () => getSpriteCapabilities());

  /**
   * GET /api/sprites/:characterId
   * List all sprite expressions for a character.
   */
  app.get<{ Params: { characterId: string } }>("/:characterId", async (req, reply) => {
    const { characterId } = req.params;
    const dir = join(SPRITES_ROOT, characterId);
    ensureDir(dir);

    try {
      const files = readdirSync(dir);
      const sprites = files
        .filter((f) => /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(f))
        .map((f) => {
          const ext = extname(f);
          const expression = f.slice(0, -ext.length);
          const mtime = statSync(join(dir, f)).mtimeMs;
          return {
            expression,
            filename: f,
            url: `/api/sprites/${characterId}/file/${encodeURIComponent(f)}?v=${Math.floor(mtime)}`,
          };
        });
      return sprites;
    } catch {
      return [];
    }
  });

  /**
   * POST /api/sprites/:characterId
   * Upload a sprite image for a given expression.
   * Body: { expression: string, image: string (base64 data URL) }
   */
  app.post<{ Params: { characterId: string } }>("/:characterId", async (req, reply) => {
    const { characterId } = req.params;

    // Prevent path traversal
    if (characterId.includes("..") || characterId.includes("/") || characterId.includes("\\")) {
      return reply.status(400).send({ error: "Invalid character ID" });
    }

    const body = req.body as { expression?: string; image?: string };

    if (!body.expression?.trim()) {
      return reply.status(400).send({ error: "Expression label is required" });
    }
    if (!body.image) {
      return reply.status(400).send({ error: "No image data provided" });
    }

    const expression = body.expression
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");

    // Parse base64
    let base64 = body.image;
    let ext = "png";
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:image\/([\w+]+);base64,/);
      if (match?.[1]) {
        ext = match[1].replace("+xml", "");
        base64 = base64.slice(base64.indexOf(",") + 1);
      }
    }

    const dir = join(SPRITES_ROOT, characterId);
    await mkdir(dir, { recursive: true });

    const filename = `${expression}.${ext}`;
    const filepath = join(dir, filename);
    await writeFile(filepath, Buffer.from(base64, "base64"));

    const mtime = statSync(filepath).mtimeMs;
    return {
      expression,
      filename,
      url: `/api/sprites/${characterId}/file/${encodeURIComponent(filename)}?v=${Math.floor(mtime)}`,
    };
  });

  /**
   * DELETE /api/sprites/:characterId/:expression
   * Remove a sprite expression image.
   */
  app.delete<{ Params: { characterId: string; expression: string } }>(
    "/:characterId/:expression",
    async (req, reply) => {
      const { characterId, expression } = req.params;

      // Prevent path traversal
      if (characterId.includes("..") || characterId.includes("/") || characterId.includes("\\")) {
        return reply.status(400).send({ error: "Invalid character ID" });
      }

      const dir = join(SPRITES_ROOT, characterId);

      if (!existsSync(dir)) {
        return reply.status(404).send({ error: "No sprites found" });
      }

      const files = readdirSync(dir);
      const match = files.find((f) => {
        const ext = extname(f);
        return f.slice(0, -ext.length) === expression;
      });

      if (!match) {
        return reply.status(404).send({ error: "Expression not found" });
      }

      unlinkSync(join(dir, match));
      return reply.status(204).send();
    },
  );

  /**
   * GET /api/sprites/:characterId/file/:filename
   * Serve a sprite image file.
   */
  app.get<{ Params: { characterId: string; filename: string } }>("/:characterId/file/:filename", async (req, reply) => {
    const { characterId, filename } = req.params;

    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/") || characterId.includes("..")) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(SPRITES_ROOT, characterId, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".svg": "image/svg+xml",
    };

    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", mimeMap[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /**
   * POST /api/sprites/generate-sheet
   * Generate an expression sheet via image generation, then slice it into individual cells.
   * Body: { connectionId, appearance, referenceImages?, expressions: string[], cols, rows }
   * Returns: { sheetBase64, cells: [{ expression, base64 }] }
   */
  app.post("/generate-sheet", async (req, reply) => {
    const body = req.body as {
      connectionId?: string;
      appearance?: string;
      referenceImage?: string;
      referenceImages?: string[];
      expressions?: string[];
      cols?: number;
      rows?: number;
      spriteType?: "expressions" | "full-body";
      noBackground?: boolean;
      cleanupStrength?: number;
    };

    if (!body.connectionId) {
      return reply.status(400).send({ error: "connectionId is required" });
    }
    if (!body.appearance?.trim()) {
      return reply.status(400).send({ error: "appearance description is required" });
    }
    if (!body.expressions || body.expressions.length === 0) {
      return reply.status(400).send({ error: "At least one expression is required" });
    }

    const cols = body.cols ?? 2;
    const rows = body.rows ?? 3;
    const expressions = body.expressions.slice(0, cols * rows);
    const cleanupStrength = Number.isFinite(body.cleanupStrength) ? Number(body.cleanupStrength) : 50;

    // Resolve image generation connection
    const connections = createConnectionsStorage(app.db);
    const conn = await connections.getWithKey(body.connectionId);
    if (!conn) {
      return reply.status(404).send({ error: "Image generation connection not found or could not be decrypted" });
    }

    const imgModel = conn.model || "";
    const imgBaseUrl = conn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = conn.apiKey || "";
    const imgSource = (conn as any).imageGenerationSource || imgModel;
    const imgServiceHint = conn.imageService || imgSource;

    // Build the prompt for an expression sheet or full-body
    const expressionList = expressions.join(", ");
    let prompt = "";
    if (body.spriteType === "full-body") {
      prompt = [
        `single full-body character sprite, one character only,`,
        `entire body visible from head to toe, centered in frame, no cropping,`,
        `solid white studio background,`,
        `${body.appearance?.trim() || ""},`,
        `general standing/idle game pose, no text, no watermark`,
      ].join(" ");
    } else {
      prompt = [
        `character expression sheet, strict ${cols} columns by ${rows} rows grid,`,
        `${cols * rows} equally sized square cells arranged in a perfectly uniform grid,`,
        `solid white background, thin straight lines separating each cell,`,
        `same character in every cell, consistent art style,`,
        `expressions left-to-right top-to-bottom: ${expressionList},`,
        `${body.appearance?.trim() || ""},`,
        `each cell shows head and shoulders portrait with a different facial expression,`,
        `all cells same size, perfectly aligned, no overlapping, no merged cells,`,
        `no text, no labels, no numbers`,
      ].join(" ");
    }

    // Parse reference images to raw base64 (supports data URL, raw base64, or local avatar URL)
    const rawRefs = body.referenceImages?.length
      ? body.referenceImages
      : body.referenceImage
        ? [body.referenceImage]
        : [];
    const resolvedRefs = rawRefs.map(resolveReferenceImageBase64).filter((r): r is string => !!r);

    try {
      if (body.spriteType === "full-body") {
        const cells: Array<{ expression: string; base64: string }> = [];
        const failedExpressions: Array<{ expression: string; error: string }> = [];

        for (const pose of expressions) {
          try {
            const posePrompt = [
              prompt,
              `pose/action: ${pose}.`,
              `Keep exactly one full character fully visible and uncropped.`,
            ].join(" ");

            const targetWidth = 832;
            const targetHeight = 1216;

            const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
              prompt: posePrompt,
              model: imgModel,
              width: targetWidth,
              height: targetHeight,
              referenceImage: resolvedRefs[0],
              referenceImages: resolvedRefs.length > 1 ? resolvedRefs : undefined,
              comfyWorkflow: conn.comfyuiWorkflow || undefined,
            });

            let spriteBuffer: Buffer = Buffer.from(imageResult.base64, "base64");

            // Normalize to the expected portrait dimensions – some providers
            // ignore or snap the requested size, returning wider / square images.
            const sharp = await getSharp();
            const meta = await sharp(spriteBuffer).metadata();
            if (meta.width && meta.height && (meta.width !== targetWidth || meta.height !== targetHeight)) {
              spriteBuffer = await sharp(spriteBuffer)
                .resize(targetWidth, targetHeight, { fit: "cover", position: "centre" })
                .png()
                .toBuffer();
            }
            if (body.noBackground) {
              try {
                spriteBuffer = await removeNearWhiteBackgroundPng(spriteBuffer, cleanupStrength);
              } catch (bgErr) {
                app.log.warn(bgErr, "Full-body sprite background cleanup failed; continuing with original image");
              }
            }

            cells.push({
              expression: pose,
              base64: spriteBuffer.toString("base64"),
            });
          } catch (poseErr: any) {
            const msg = String(poseErr?.message || "Generation failed")
              .replace(/<[^>]*>/g, "")
              .slice(0, 300);
            app.log.warn(poseErr, `Full-body pose "${pose}" generation failed; skipping`);
            failedExpressions.push({ expression: pose, error: msg });
          }
        }

        if (cells.length === 0) {
          return reply.status(500).send({
            error: "All pose generations failed",
            failedExpressions,
          });
        }

        return {
          sheetBase64: "",
          cells,
          ...(failedExpressions.length > 0 ? { failedExpressions } : {}),
        };
      }

      // Generate the sheet image.
      // Size the canvas so each cell is roughly square (~512px) — this makes
      // the grid aspect ratio match the requested cols×rows and prevents
      // the model from producing misaligned layouts that slice incorrectly.
      const cellSize = 512;
      const sheetWidth = cols * cellSize;
      const sheetHeight = rows * cellSize;

      const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
        prompt,
        model: imgModel,
        width: sheetWidth,
        height: sheetHeight,
        referenceImage: resolvedRefs[0],
        referenceImages: resolvedRefs.length > 1 ? resolvedRefs : undefined,
        comfyWorkflow: conn.comfyuiWorkflow || undefined,
      });

      // Decode the generated image
      let sheetBuffer: Buffer = Buffer.from(imageResult.base64, "base64");
      const sharp = await getSharp();
      let metadata = await sharp(sheetBuffer).metadata();

      // If noBackground is requested, remove near-white background after generation.
      // Keep this resilient: if cleanup fails, continue with the original image rather than throwing.
      if (body.noBackground) {
        const originalSheetBuffer = sheetBuffer;
        try {
          sheetBuffer = await removeNearWhiteBackgroundPng(sheetBuffer, cleanupStrength);
          metadata = await sharp(sheetBuffer).metadata();
        } catch (bgErr) {
          app.log.warn(bgErr, "Sprite background cleanup failed; continuing with original image");
          sheetBuffer = originalSheetBuffer;
          metadata = await sharp(sheetBuffer).metadata();
        }
      }

      const imgWidth = metadata.width ?? (cols <= 2 ? 1024 : 1536);
      const imgHeight = metadata.height ?? (rows <= 2 ? 1024 : 1536);

      const cellWidth = Math.floor(imgWidth / cols);
      const cellHeight = Math.floor(imgHeight / rows);

      const cellPromises: Promise<{ expression: string; base64: string }>[] = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (idx >= expressions.length) break;

          const expression = expressions[idx]!;
          const left = col * cellWidth;
          const top = row * cellHeight;

          cellPromises.push(
            sharp(sheetBuffer)
              .extract({ left, top, width: cellWidth, height: cellHeight })
              .png()
              .toBuffer()
              .then((buf: Buffer) => ({
                expression,
                base64: buf.toString("base64"),
              })),
          );
        }
      }

      const cells = await Promise.all(cellPromises);

      return {
        sheetBase64: sheetBuffer.toString("base64"),
        cells,
      };
    } catch (err: any) {
      app.log.error(err, "Sprite sheet generation failed");
      return reply.status(500).send({
        error: err?.message || "Sprite sheet generation failed",
      });
    }
  });

  /**
   * POST /api/sprites/cleanup
   * Apply near-white background cleanup to already generated sprites.
   * Body: { cells: [{ expression, base64 }], cleanupStrength }
   * Returns: { cells: [{ expression, base64 }] }
   */
  app.post("/cleanup", async (req, reply) => {
    const body = req.body as {
      cells?: Array<{ expression?: string; base64?: string }>;
      cleanupStrength?: number;
    };

    if (!body.cells || body.cells.length === 0) {
      return reply.status(400).send({ error: "At least one cell is required" });
    }

    const cleanupStrength = Number.isFinite(body.cleanupStrength) ? Number(body.cleanupStrength) : 50;

    try {
      const processed = await Promise.all(
        body.cells.map(async (cell) => {
          const base64 = extractBase64ImageData(cell.base64 ?? "");
          if (!base64 || !looksLikeBase64(base64)) {
            throw new Error(`Invalid base64 image for expression: ${cell.expression ?? "unknown"}`);
          }

          const inputBuffer = Buffer.from(base64, "base64");
          const outputBuffer = await removeNearWhiteBackgroundPng(inputBuffer, cleanupStrength);

          return {
            expression: cell.expression ?? "",
            base64: outputBuffer.toString("base64"),
          };
        }),
      );

      return { cells: processed };
    } catch (err: any) {
      app.log.error(err, "Sprite cleanup failed");
      return reply.status(500).send({
        error: err?.message || "Sprite cleanup failed",
      });
    }
  });
}
