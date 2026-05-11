// ──────────────────────────────────────────────
// Routes: Game Asset serving, upload, manifest
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  createWriteStream,
  readdirSync,
  statSync,
  rmdirSync,
  renameSync,
  copyFileSync,
  readFileSync,
} from "fs";
import { join, extname, basename, dirname } from "path";
import { execFile } from "child_process";
import { platform } from "os";
import { z } from "zod";
import { pipeline } from "stream/promises";
import { MUSIC_GENRES, MUSIC_INTENSITIES } from "@marinara-engine/shared";
import { GAME_ASSETS_DIR, buildAssetManifest, getAssetManifest } from "../services/game/asset-manifest.service.js";
import { assertInsideDir } from "../utils/security.js";

const META_PATH = join(GAME_ASSETS_DIR, "meta.json");

interface FolderMeta {
  description?: string;
}

function loadMeta(): Record<string, FolderMeta> {
  if (!existsSync(META_PATH)) return {};
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveMeta(meta: Record<string, FolderMeta>) {
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

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

const CATEGORY_EXTENSIONS: Record<string, Set<string>> = {
  music: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  sfx: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  ambient: new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".webm"]),
  sprites: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]),
  backgrounds: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]),
};
const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_EXTENSIONS));
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MUSIC_STATES = ["exploration", "dialogue", "combat", "travel_rest"] as const;
const MUSIC_STATE_SET = new Set<string>(MUSIC_STATES);
const MUSIC_GENRE_SET = new Set<string>(MUSIC_GENRES);
const MUSIC_INTENSITY_SET = new Set<string>(MUSIC_INTENSITIES);

/** Reject path-traversal attempts. */
function isSafePath(segment: string): boolean {
  return !segment.includes("..") && !segment.includes("\\") && !/^\//.test(segment);
}

const uploadSchema = z.object({
  /** Category: music, ambient, sfx, sprites, backgrounds */
  category: z.string().refine((c) => VALID_CATEGORIES.has(c), "Invalid category"),
  /** Sub-category folder, e.g. "combat", "custom", "generic-fantasy" */
  subcategory: z.string().min(1).max(100),
  /** Filename (including extension) */
  filename: z.string().min(1).max(200),
  /** Base64-encoded file data (with or without data URL prefix) */
  data: z.string().min(1),
});

function fieldValue(fields: unknown, name: string): string | undefined {
  const value = (fields as Record<string, { value?: unknown } | undefined> | undefined)?.[name]?.value;
  return typeof value === "string" ? value : undefined;
}

function sanitizeAssetFilename(filename: string): string {
  const original = basename(filename).trim();
  const ext = extname(original).toLowerCase();
  const stem = basename(original, ext)
    .normalize("NFKD")
    .replace(/[^\w .-]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[.-]+|[.-]+$/g, "");
  return `${stem || "asset"}${ext}`;
}

function uniqueFilename(dir: string, filename: string): string {
  const ext = extname(filename);
  const stem = basename(filename, ext);
  let candidate = filename;
  let counter = 1;
  while (existsSync(join(dir, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

function prepareAssetTarget(category: string, subcategory: string, filename: string) {
  if (!isSafePath(subcategory)) {
    throw new Error("Invalid subcategory");
  }
  if (category === "music") {
    const parts = subcategory.split("/").filter(Boolean);
    const [state, genre, intensity] = parts;
    if (
      parts.length !== 3 ||
      !state ||
      !genre ||
      !intensity ||
      !MUSIC_STATE_SET.has(state) ||
      !MUSIC_GENRE_SET.has(genre) ||
      !MUSIC_INTENSITY_SET.has(intensity)
    ) {
      throw new Error("Music folder must be state/genre/intensity, e.g. exploration/fantasy/calm");
    }
  }

  const ext = extname(filename).toLowerCase();
  const allowedExts = CATEGORY_EXTENSIONS[category];
  if (!allowedExts?.has(ext)) {
    throw new Error(`Unsupported ${category} file type: ${ext || "(none)"}`);
  }

  const targetDir = join(GAME_ASSETS_DIR, category, subcategory);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const safeName = uniqueFilename(targetDir, sanitizeAssetFilename(filename));
  const targetPath = join(targetDir, safeName);
  return { safeName, targetPath, targetDir };
}

function finishAssetUpload(category: string, subcategory: string, filename: string) {
  const manifest = buildAssetManifest();
  const rel = `${category}/${subcategory}/${filename}`;
  const tag = rel.replace(/\.[^.]+$/, "").replace(/\//g, ":");
  return { tag, path: rel, manifestCount: manifest.count };
}

// ════════════════════════════════════════════════
// Tree helpers
// ════════════════════════════════════════════════

interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
  ext?: string;
  description?: string;
}

function buildTree(dir: string, relPrefix: string, meta: Record<string, FolderMeta>): TreeNode[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (entry === "manifest.json" && relPrefix === "") continue;
    if (entry === "meta.json" && relPrefix === "") continue;

    const full = join(dir, entry);
    const rel = relPrefix ? `${relPrefix}/${entry}` : entry;
    const stat = statSync(full);

    if (stat.isDirectory()) {
      const children = buildTree(full, rel, meta);
      nodes.push({
        name: entry,
        path: rel,
        type: "folder",
        children,
        description: meta[rel]?.description,
      });
    } else {
      const ext = extname(entry).toLowerCase();
      nodes.push({ name: entry, path: rel, type: "file", ext });
    }
  }

  // Sort: folders first, then alphabetically
  nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "folder" ? -1 : 1;
  });

  return nodes;
}

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
    const contentType = req.headers["content-type"] ?? "";
    if (contentType.includes("multipart/form-data")) {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const category = fieldValue(file.fields, "category") ?? "";
      const subcategory = fieldValue(file.fields, "subcategory") ?? "custom";
      if (!VALID_CATEGORIES.has(category)) {
        return reply.status(400).send({ error: "Invalid category" });
      }

      let target;
      try {
        target = prepareAssetTarget(category, subcategory, file.filename);
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid upload" });
      }

      await pipeline(file.file, createWriteStream(target.targetPath));
      return finishAssetUpload(category, subcategory, target.safeName);
    }

    const { category, subcategory, filename, data } = uploadSchema.parse(req.body);

    if (!isSafePath(subcategory) || !isSafePath(filename)) {
      return reply.status(400).send({ error: "Invalid path segments" });
    }

    let target;
    try {
      target = prepareAssetTarget(category, subcategory, filename);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid upload" });
    }

    // Strip data URL prefix if present
    const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
    const rawBase64 = base64Match ? base64Match[1]! : data;
    const buffer = Buffer.from(rawBase64, "base64");

    // Size limit: 50MB
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return reply.status(400).send({ error: "File too large (max 50MB)" });
    }

    writeFileSync(target.targetPath, buffer);

    return finishAssetUpload(category, subcategory, target.safeName);
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
      if (err) logger.warn(err, "Could not open game assets folder");
    });
    return reply.send({ ok: true, path: target });
  });

  // ── GET /game-assets/tree ──
  app.get("/tree", async () => {
    const meta = loadMeta();
    const children = buildTree(GAME_ASSETS_DIR, "", meta);
    return { name: "game-assets", path: "", type: "folder" as const, children, description: meta[""]?.description };
  });

  // ── PATCH /game-assets/folders/description ──
  app.patch("/folders/description", async (req, reply) => {
    const schema = z.object({
      path: z.string().min(1).max(300),
      description: z.string().max(500),
    });
    const { path: folderPath, description } = schema.parse(req.body);

    if (!isSafePath(folderPath)) {
      return reply.status(400).send({ error: "Invalid folder path" });
    }

    const target = join(GAME_ASSETS_DIR, folderPath);
    try {
      assertInsideDir(GAME_ASSETS_DIR, target);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(target) || !statSync(target).isDirectory()) {
      return reply.status(404).send({ error: "Folder not found" });
    }

    const meta = loadMeta();
    if (description.trim()) {
      meta[folderPath] = { ...meta[folderPath], description: description.trim() };
    } else {
      delete meta[folderPath]?.description;
      if (meta[folderPath] && Object.keys(meta[folderPath]).length === 0) {
        delete meta[folderPath];
      }
    }
    saveMeta(meta);
    return { path: folderPath, description: description.trim() || null };
  });

  // ── POST /game-assets/folders ──
  app.post("/folders", async (req, reply) => {
    const schema = z.object({
      path: z.string().min(1).max(300),
    });
    const { path: folderPath } = schema.parse(req.body);

    if (!isSafePath(folderPath)) {
      return reply.status(400).send({ error: "Invalid folder path" });
    }

    const target = join(GAME_ASSETS_DIR, folderPath);
    try {
      assertInsideDir(GAME_ASSETS_DIR, target);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (existsSync(target)) {
      return reply.status(409).send({ error: "Folder already exists" });
    }

    mkdirSync(target, { recursive: true });
    buildAssetManifest();
    return { created: folderPath };
  });

  // ── DELETE /game-assets/folders/* ──
  app.delete("/folders/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid folder path" });
    }

    const target = join(GAME_ASSETS_DIR, wildcard);
    try {
      assertInsideDir(GAME_ASSETS_DIR, target);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(target)) {
      return reply.status(404).send({ error: "Folder not found" });
    }

    const stat = statSync(target);
    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: "Not a directory" });
    }

    const entries = readdirSync(target);
    const recursive = (req.query as { recursive?: string }).recursive === "true";

    if (entries.length > 0 && !recursive) {
      return reply.status(400).send({ error: "Folder is not empty", fileCount: entries.length });
    }

    if (recursive && entries.length > 0) {
      const { rmSync } = await import("fs");
      rmSync(target, { recursive: true, force: true });
    } else {
      rmdirSync(target);
    }

    buildAssetManifest();
    return { deleted: wildcard, recursive };
  });

  // ── POST /game-assets/rename ──
  app.post("/rename", async (req, reply) => {
    const schema = z.object({
      path: z.string().min(1).max(500),
      newName: z.string().min(1).max(200),
    });
    const { path: filePath, newName } = schema.parse(req.body);

    if (!isSafePath(filePath) || !isSafePath(newName)) {
      return reply.status(400).send({ error: "Invalid path or name" });
    }

    const oldFull = join(GAME_ASSETS_DIR, filePath);
    try {
      assertInsideDir(GAME_ASSETS_DIR, oldFull);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(oldFull)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const dir = dirname(oldFull);
    const newFull = join(dir, sanitizeAssetFilename(newName));
    try {
      assertInsideDir(GAME_ASSETS_DIR, newFull);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (existsSync(newFull)) {
      return reply.status(409).send({ error: "A file with that name already exists" });
    }

    renameSync(oldFull, newFull);
    buildAssetManifest();
    const rel = filePath.replace(/\/[^/]+$/, "");
    const newRel = rel ? `${rel}/${basename(newFull)}` : basename(newFull);
    return { oldPath: filePath, newPath: newRel };
  });

  // ── POST /game-assets/move ──
  app.post("/move", async (req, reply) => {
    const schema = z.object({
      path: z.string().min(1).max(500),
      targetFolder: z.string().min(1).max(300),
    });
    const { path: filePath, targetFolder } = schema.parse(req.body);

    if (!isSafePath(filePath) || !isSafePath(targetFolder)) {
      return reply.status(400).send({ error: "Invalid path or target folder" });
    }

    const oldFull = join(GAME_ASSETS_DIR, filePath);
    try {
      assertInsideDir(GAME_ASSETS_DIR, oldFull);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(oldFull)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const destDir = join(GAME_ASSETS_DIR, targetFolder);
    try {
      assertInsideDir(GAME_ASSETS_DIR, destDir);
    } catch {
      return reply.status(400).send({ error: "Target escapes game assets directory" });
    }

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    const safeName = uniqueFilename(destDir, basename(filePath));
    const newFull = join(destDir, safeName);
    renameSync(oldFull, newFull);
    buildAssetManifest();

    const newRel = `${targetFolder}/${safeName}`;
    return { oldPath: filePath, newPath: newRel };
  });

  // ── POST /game-assets/copy ──
  app.post("/copy", async (req, reply) => {
    const schema = z.object({
      path: z.string().min(1).max(500),
      targetFolder: z.string().min(1).max(300),
    });
    const { path: filePath, targetFolder } = schema.parse(req.body);

    if (!isSafePath(filePath) || !isSafePath(targetFolder)) {
      return reply.status(400).send({ error: "Invalid path or target folder" });
    }

    const oldFull = join(GAME_ASSETS_DIR, filePath);
    try {
      assertInsideDir(GAME_ASSETS_DIR, oldFull);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(oldFull)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const destDir = join(GAME_ASSETS_DIR, targetFolder);
    try {
      assertInsideDir(GAME_ASSETS_DIR, destDir);
    } catch {
      return reply.status(400).send({ error: "Target escapes game assets directory" });
    }

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    const safeName = uniqueFilename(destDir, basename(filePath));
    const newFull = join(destDir, safeName);
    copyFileSync(oldFull, newFull);
    buildAssetManifest();

    const newRel = `${targetFolder}/${safeName}`;
    return { sourcePath: filePath, newPath: newRel };
  });
}
