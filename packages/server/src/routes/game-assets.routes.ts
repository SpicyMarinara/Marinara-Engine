// ──────────────────────────────────────────────
// Routes: Game Asset serving, upload, manifest
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { existsSync, mkdirSync, writeFileSync, createReadStream } from "fs";
import { join, extname, dirname } from "path";
import { execFile } from "child_process";
import { platform } from "os";
import { z } from "zod";
import { GAME_ASSETS_DIR, buildAssetManifest, getAssetManifest } from "../services/game/asset-manifest.service.js";

const MIME_MAP: Record<string, string> = {
  // Audio
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const VALID_CATEGORIES = new Set(["music", "sfx", "sprites", "backgrounds"]);

/** Reject path-traversal attempts. */
function isSafePath(segment: string): boolean {
  return !segment.includes("..") && !segment.includes("\\") && !/^\//.test(segment);
}

const uploadSchema = z.object({
  /** Category: music, sfx, sprites, backgrounds */
  category: z.string().refine((c) => VALID_CATEGORIES.has(c), "Invalid category"),
  /** Sub-category folder, e.g. "combat", "custom", "generic-fantasy" */
  subcategory: z.string().min(1).max(100),
  /** Filename (including extension) */
  filename: z.string().min(1).max(200),
  /** Base64-encoded file data (with or without data URL prefix) */
  data: z.string().min(1),
});

export async function gameAssetsRoutes(app: FastifyInstance) {
  // ── GET /game-assets/manifest ──
  app.get("/manifest", async () => {
    return getAssetManifest();
  });

  // ── POST /game-assets/rescan ──
  app.post("/rescan", async () => {
    const manifest = buildAssetManifest();
    return { scannedAt: manifest.scannedAt, count: manifest.count };
  });

  // ── GET /game-assets/file/* ──
  // Serves any file under game-assets/ by relative path
  app.get("/file/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(GAME_ASSETS_DIR, wildcard);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Asset not found" });
    }

    const ext = extname(wildcard).toLowerCase();
    const mime = MIME_MAP[ext] ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    return reply.header("Content-Type", mime).header("Cache-Control", "public, max-age=604800").send(stream);
  });

  // ── POST /game-assets/upload ──
  app.post("/upload", async (req, reply) => {
    const { category, subcategory, filename, data } = uploadSchema.parse(req.body);

    if (!isSafePath(subcategory) || !isSafePath(filename)) {
      return reply.status(400).send({ error: "Invalid path segments" });
    }

    // Strip data URL prefix if present
    const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
    const rawBase64 = base64Match ? base64Match[1]! : data;
    const buffer = Buffer.from(rawBase64, "base64");

    // Size limit: 50MB
    if (buffer.length > 50 * 1024 * 1024) {
      return reply.status(400).send({ error: "File too large (max 50MB)" });
    }

    const targetDir = join(GAME_ASSETS_DIR, category, subcategory);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    const targetPath = join(targetDir, filename);
    writeFileSync(targetPath, buffer);

    // Rebuild manifest after upload
    const manifest = buildAssetManifest();

    const rel = `${category}/${subcategory}/${filename}`;
    const tag = rel.replace(/\.[^.]+$/, "").replace(/\//g, ":");

    return { tag, path: rel, manifestCount: manifest.count };
  });

  // ── DELETE /game-assets/file/* ──
  app.delete("/file/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(GAME_ASSETS_DIR, wildcard);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Asset not found" });
    }

    const { unlinkSync } = await import("fs");
    unlinkSync(filePath);

    // Rebuild manifest after deletion
    buildAssetManifest();

    return { deleted: wildcard };
  });

  // ── POST /game-assets/open-folder ──
  app.post("/open-folder", async (req, reply) => {
    const { subfolder } = (req.body as { subfolder?: string }) ?? {};
    let target = GAME_ASSETS_DIR;
    if (subfolder && isSafePath(subfolder)) {
      target = join(GAME_ASSETS_DIR, subfolder);
    }
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    const os = platform();
    const cmd = os === "darwin" ? "open" : os === "win32" ? "explorer" : "xdg-open";
    execFile(cmd, [target], (err) => {
      if (err) logger.warn("Could not open game assets folder: %s", err.message);
    });
    return reply.send({ ok: true, path: target });
  });
}
