// ──────────────────────────────────────────────
// Routes: Chat Backgrounds (upload, list, delete, serve, tags, rename)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync, writeFileSync, renameSync } from "fs";
import { writeFile } from "fs/promises";
import { join, extname, basename, parse as parsePath } from "path";
import { DATA_DIR } from "../utils/data-dir.js";
import { buildAssetManifest, getAssetManifest } from "../services/game/asset-manifest.service.js";
import { assertInsideDir, isAllowedImageBuffer } from "../utils/security.js";

const BG_DIR = join(DATA_DIR, "backgrounds");
const META_PATH = join(BG_DIR, "meta.json");

// Ensure directory exists
function ensureDir() {
  if (!existsSync(BG_DIR)) {
    mkdirSync(BG_DIR, { recursive: true });
  }
}

interface BgMeta {
  originalName?: string;
  tags: string[];
}
type MetaMap = Record<string, BgMeta>;

function readMeta(): MetaMap {
  ensureDir();
  if (!existsSync(META_PATH)) return {};
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8")) as MetaMap;
  } catch {
    return {};
  }
}

function writeMeta(meta: MetaMap) {
  ensureDir();
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const BACKGROUND_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Sanitise a filename: keep alphanumeric, spaces, hyphens, underscores, dots. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _.\-]/g, "").trim();
}

/** Given a desired filename, return a unique filename that doesn't collide with existing files. */
function uniqueFilename(desired: string): string {
  if (!existsSync(join(BG_DIR, desired))) return desired;
  const { name, ext } = parsePath(desired);
  let i = 2;
  while (existsSync(join(BG_DIR, `${name}_${i}${ext}`))) i++;
  return `${name}_${i}${ext}`;
}

function encodeAssetPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function backgroundsRoutes(app: FastifyInstance) {
  // List all backgrounds (includes tags)
  app.get("/", async () => {
    ensureDir();
    const meta = readMeta();
    const files = readdirSync(BG_DIR).filter((f) => {
      const ext = extname(f).toLowerCase();
      return ALLOWED_EXTS.has(ext);
    });
    const userBackgrounds = files.map((filename) => ({
      id: `user:${filename}`,
      filename,
      url: `/api/backgrounds/file/${encodeURIComponent(filename)}`,
      originalName: meta[filename]?.originalName ?? null,
      tags: meta[filename]?.tags ?? [],
      source: "user" as const,
      editable: true,
      deletable: true,
      renameable: true,
    }));

    const gameAssetBackgrounds = (getAssetManifest().byCategory.backgrounds ?? [])
      .filter((entry) => !entry.path.startsWith("__user_bg__/"))
      .map((entry) => ({
        id: `game:${entry.tag}`,
        filename: `${entry.name}${entry.ext}`,
        url: `/api/game-assets/file/${encodeAssetPath(entry.path)}`,
        originalName: entry.tag,
        tags: entry.subcategory ? [entry.subcategory] : [],
        source: "game_asset" as const,
        tag: entry.tag,
        editable: false,
        deletable: false,
        renameable: false,
      }));

    return [...userBackgrounds, ...gameAssetBackgrounds];
  });

  // List all unique tags (for autocomplete)
  app.get("/tags", async () => {
    const meta = readMeta();
    const tagSet = new Set<string>();
    for (const entry of Object.values(meta)) {
      for (const t of entry.tags) tagSet.add(t);
    }
    return [...tagSet].sort();
  });

  // Upload a new background (preserves original filename)
  app.post("/upload", async (req, reply) => {
    ensureDir();
    const data = await req.file({ limits: { fileSize: BACKGROUND_UPLOAD_MAX_BYTES } });
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return reply.status(400).send({ error: `Unsupported file type: ${ext}` });
    }

    // Use the original filename (sanitised) instead of a UUID
    const sanitized = sanitizeFilename(basename(data.filename));
    const safeName = sanitized ? uniqueFilename(sanitized) : uniqueFilename(`background${ext}`);
    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, safeName));
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({ error: "Background image is too large" });
      }
      throw err;
    }
    if (!isAllowedImageBuffer(buffer, ext)) {
      return reply.status(400).send({ error: "Unsupported or invalid image file" });
    }
    await writeFile(filePath, buffer);

    // Store metadata
    const meta = readMeta();
    meta[safeName] = { originalName: data.filename, tags: [] };
    writeMeta(meta);

    // Rebuild game asset manifest so scene analysis picks up new backgrounds
    buildAssetManifest();

    return {
      success: true,
      filename: safeName,
      originalName: data.filename,
      url: `/api/backgrounds/file/${encodeURIComponent(safeName)}`,
      tags: [],
    };
  });

  // Set tags for a background
  app.patch("/:filename/tags", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const body = req.body as { tags?: string[] };
    if (!Array.isArray(body?.tags)) {
      return reply.status(400).send({ error: "tags must be an array of strings" });
    }

    // Sanitise: lowercase, trim, unique, limit length
    const tags = [
      ...new Set(
        body.tags
          .map((t: unknown) =>
            String(t)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9 _-]/g, ""),
          )
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    ];

    const meta = readMeta();
    if (!meta[filename]) meta[filename] = { tags: [] };
    meta[filename].tags = tags;
    writeMeta(meta);

    return { success: true, tags };
  });

  // Rename a background file
  app.patch("/:filename/rename", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const body = req.body as { name?: string };
    if (!body?.name || typeof body.name !== "string") {
      return reply.status(400).send({ error: "name is required" });
    }

    // Keep the existing extension
    const ext = extname(filename).toLowerCase();
    const rawName = sanitizeFilename(body.name.replace(/\.[^.]+$/, "")); // strip any extension they included
    if (!rawName) {
      return reply.status(400).send({ error: "Name is empty after sanitisation" });
    }

    const desired = `${rawName}${ext}`;
    if (desired === filename) {
      return { success: true, filename, url: `/api/backgrounds/file/${encodeURIComponent(filename)}` };
    }

    const newFilename = uniqueFilename(desired);
    const newPath = assertInsideDir(BG_DIR, join(BG_DIR, newFilename));

    renameSync(filePath, newPath);

    // Move metadata entry
    const meta = readMeta();
    if (meta[filename]) {
      meta[newFilename] = meta[filename];
      delete meta[filename];
    }
    writeMeta(meta);

    // Rebuild game asset manifest
    buildAssetManifest();

    return {
      success: true,
      oldFilename: filename,
      filename: newFilename,
      url: `/api/backgrounds/file/${encodeURIComponent(newFilename)}`,
    };
  });

  // Serve a background file
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
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
    };

    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", mimeMap[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  // Delete a background
  app.delete("/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    if (filename.includes("..") || filename.includes("/")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(BG_DIR, join(BG_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    unlinkSync(filePath);

    // Remove from metadata
    const meta = readMeta();
    delete meta[filename];
    writeMeta(meta);

    // Rebuild game asset manifest
    buildAssetManifest();

    return { success: true };
  });
}
