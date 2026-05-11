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
import sharp from "sharp";
import { MUSIC_GENRES, MUSIC_INTENSITIES } from "@marinara-engine/shared";
import { GAME_ASSETS_DIR, buildAssetManifest, getAssetManifest } from "../services/game/asset-manifest.service.js";
import { assertInsideDir } from "../utils/security.js";

const META_PATH = join(GAME_ASSETS_DIR, "meta.json");

interface FolderMeta {
  description?: string;
}

/**
 * Load folder metadata from `data/game-assets/meta.json`.
 * @returns Map of folder paths to their metadata
 */
function loadMeta(): Record<string, FolderMeta> {
  if (!existsSync(META_PATH)) return {};
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Persist folder metadata back to `data/game-assets/meta.json`.
 * @param meta - Map of folder paths to metadata
 */
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
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
const TEXT_EXTS = new Set([".txt", ".md", ".json", ".yaml", ".yml", ".js", ".ts", ".tsx", ".css", ".html"]);
const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_EXTENSIONS));
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MUSIC_STATES = ["exploration", "dialogue", "combat", "travel_rest"] as const;
const MUSIC_STATE_SET = new Set<string>(MUSIC_STATES);
const MUSIC_GENRE_SET = new Set<string>(MUSIC_GENRES);
const MUSIC_INTENSITY_SET = new Set<string>(MUSIC_INTENSITIES);

/**
 * Reject path-traversal attempts in a URL segment.
 * @param segment - URL path segment to validate
 * @returns true if the segment contains no `..`, backslashes, or leading slashes
 */
function isSafePath(segment: string): boolean {
  return !segment.includes("..") && !segment.includes("\\") && !/^\//.test(segment);
}

const uploadSchema = z.object({
  /** Category: music, ambient, sfx, sprites, backgrounds */
  category: z.string().refine((c) => VALID_CATEGORIES.has(c), "Invalid category"),
  /** Sub-category folder, e.g. "combat", "custom", "generic-fantasy" */
  subcategory: z.string().max(100),
  /** Filename (including extension) */
  filename: z.string().min(1).max(200),
  /** Base64-encoded file data (with or without data URL prefix) */
  data: z.string().min(1),
});

function fieldValue(fields: unknown, name: string): string | undefined {
  const value = (fields as Record<string, { value?: unknown } | undefined> | undefined)?.[name]?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Sanitize an uploaded filename for safe filesystem storage.
 * Normalizes Unicode, removes special chars, collapses spaces to hyphens.
 * @param filename - Raw filename from upload
 * @returns Clean filename safe to write to disk
 */
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

/**
 * Generate a unique filename inside a directory by appending a counter
 * if the base name already exists.
 * @param dir - Target directory path
 * @param filename - Desired filename
 * @returns Unique filename (e.g. "asset.png" or "asset-1.png")
 */
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

/**
 * Validate upload parameters and compute the safe target path on disk.
 *
 * Checks:
 * - Path safety (no traversal)
 * - Music folder structure (state/genre/intensity)
 * - Extension matches category rules (or is a text file)
 *
 * @param category - Top-level category (music, sfx, sprites, etc.)
 * @param subcategory - Subfolder path inside the category
 * @param filename - Original uploaded filename
 * @returns Object with safeName, targetPath, and targetDir
 * @throws Error if validation fails
 */
function prepareAssetTarget(category: string, subcategory: string, filename: string) {
  if (!isSafePath(subcategory)) {
    throw new Error("Invalid subcategory");
  }

  const ext = extname(filename).toLowerCase();
  const isTextFile = TEXT_EXTS.has(ext);
  const allowedExts = CATEGORY_EXTENSIONS[category];
  if (!isTextFile && !allowedExts?.has(ext)) {
    const typeLabel = category === "music" || category === "sfx" || category === "ambient"
      ? "audio files"
      : category === "sprites" || category === "backgrounds"
        ? "images"
        : "files";
    const extList = allowedExts ? Array.from(allowedExts).join(", ") : "";
    throw new Error(`Can't upload ${ext} to ${category}. This folder only accepts ${typeLabel} (${extList})`);
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

  const targetDir = join(GAME_ASSETS_DIR, category, subcategory);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const safeName = uniqueFilename(targetDir, sanitizeAssetFilename(filename));
  const targetPath = join(targetDir, safeName);
  return { safeName, targetPath, targetDir };
}

/**
 * Finalize an upload by rebuilding the asset manifest.
 * @param category - Top-level category
 * @param subcategory - Subfolder path
 * @param filename - Safe filename on disk
 * @returns Object with tag, path, and manifest count
 */
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
  size?: number;
  modified?: string;
  native?: boolean;
}

/**
 * Recursively build a tree of folders and files under a directory.
 *
 * Skips hidden files, `manifest.json`, and `meta.json` at root.
 * Sorts folders first, then alphabetically.
 *
 * @param dir - Absolute directory to scan
 * @param relPrefix - Relative prefix for building node paths
 * @param meta - Loaded folder metadata
 * @returns Array of TreeNode objects
 */
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
        native: existsSync(join(full, ".native")),
      });
    } else {
      const ext = extname(entry).toLowerCase();
      nodes.push({
        name: entry,
        path: rel,
        type: "file",
        ext,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  // Sort: folders first, then alphabetically
  nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "folder" ? -1 : 1;
  });

  return nodes;
}

/**
 * Register all game-asset routes on the given Fastify instance.
 *
 * Endpoints:
 * - GET  /manifest
 * - POST /rescan
 * - GET  /file/*
 * - POST /upload
 * - DELETE /file/*
 * - POST /open-folder
 * - GET  /tree
 * - PATCH /folders/description
 * - POST /folders
 * - DELETE /folders/*
 * - POST /rename
 * - POST /move
 * - POST /copy
 * - POST /move-bulk
 * - POST /copy-bulk
 * - POST /delete-bulk
 * - GET  /file-content/*
 * - PUT  /file-content/*
 * - GET  /file-info/*
 *
 * @param app - Fastify instance
 */
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

      const writtenSize = statSync(target.targetPath).size;
      const ext = extname(file.filename).toLowerCase();
      const isTextFile = TEXT_EXTS.has(ext);
      const maxBytes = isTextFile ? MAX_TEXT_BYTES : MAX_UPLOAD_BYTES;
      const maxLabel = isTextFile ? "10MB" : "50MB";

      if (writtenSize > maxBytes) {
        const { unlinkSync } = await import("fs");
        unlinkSync(target.targetPath);
        return reply.status(400).send({ error: `File too large: ${file.filename} is ${(writtenSize / 1024 / 1024).toFixed(1)} MB. Max size: ${maxLabel}.` });
      }

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

    const ext = extname(filename).toLowerCase();
    const isTextFile = TEXT_EXTS.has(ext);
    const maxBytes = isTextFile ? MAX_TEXT_BYTES : MAX_UPLOAD_BYTES;
    const maxLabel = isTextFile ? "10MB" : "50MB";

    if (buffer.length > maxBytes) {
      return reply.status(400).send({ error: `File too large: ${filename} is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. Max size: ${maxLabel}.` });
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

    if (VALID_CATEGORIES.has(wildcard)) {
      return reply.status(403).send({ error: "Cannot delete root category folders" });
    }

    const target = join(GAME_ASSETS_DIR, wildcard);

    if (existsSync(join(target, ".native"))) {
      return reply.status(403).send({ error: "Cannot delete native folders" });
    }
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
    const visibleEntries = entries.filter((e) => !e.startsWith("."));
    const recursive = (req.query as { recursive?: string }).recursive === "true";

    if (visibleEntries.length > 0 && !recursive) {
      return reply.status(400).send({ error: "Folder is not empty", fileCount: visibleEntries.length });
    }

    try {
      if (recursive && visibleEntries.length > 0) {
        const { rmSync } = await import("fs");
        rmSync(target, { recursive: true, force: true });
      } else {
        rmdirSync(target);
      }
    } catch (err) {
      return reply.status(500).send({ error: "Failed to delete folder", detail: String(err) });
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

  // ── POST /game-assets/move-bulk ──
  app.post("/move-bulk", async (req, reply) => {
    const schema = z.object({
      paths: z.array(z.string().min(1).max(500)).min(1).max(100),
      targetFolder: z.string().min(1).max(300),
    });
    const { paths, targetFolder } = schema.parse(req.body);

    if (!isSafePath(targetFolder)) {
      return reply.status(400).send({ error: "Invalid target folder" });
    }
    const destDir = join(GAME_ASSETS_DIR, targetFolder);
    try {
      assertInsideDir(GAME_ASSETS_DIR, destDir);
    } catch {
      return reply.status(400).send({ error: "Target escapes game assets directory" });
    }
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    const succeeded: string[] = [];
    const failed: { path: string; error: string }[] = [];

    for (const filePath of paths) {
      if (!isSafePath(filePath)) {
        failed.push({ path: filePath, error: "Invalid path" });
        continue;
      }
      const oldFull = join(GAME_ASSETS_DIR, filePath);
      try {
        assertInsideDir(GAME_ASSETS_DIR, oldFull);
      } catch {
        failed.push({ path: filePath, error: "Path escapes game assets directory" });
        continue;
      }
      if (!existsSync(oldFull)) {
        failed.push({ path: filePath, error: "File not found" });
        continue;
      }
      const stat = statSync(oldFull);
      if (!stat.isFile()) {
        failed.push({ path: filePath, error: "Not a file" });
        continue;
      }
      const safeName = uniqueFilename(destDir, basename(filePath));
      const newFull = join(destDir, safeName);
      renameSync(oldFull, newFull);
      succeeded.push(filePath);
    }

    if (succeeded.length > 0) buildAssetManifest();
    return { succeeded, failed, targetFolder };
  });

  // ── POST /game-assets/copy-bulk ──
  app.post("/copy-bulk", async (req, reply) => {
    const schema = z.object({
      paths: z.array(z.string().min(1).max(500)).min(1).max(100),
      targetFolder: z.string().min(1).max(300),
    });
    const { paths, targetFolder } = schema.parse(req.body);

    if (!isSafePath(targetFolder)) {
      return reply.status(400).send({ error: "Invalid target folder" });
    }
    const destDir = join(GAME_ASSETS_DIR, targetFolder);
    try {
      assertInsideDir(GAME_ASSETS_DIR, destDir);
    } catch {
      return reply.status(400).send({ error: "Target escapes game assets directory" });
    }
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    const succeeded: string[] = [];
    const failed: { path: string; error: string }[] = [];

    for (const filePath of paths) {
      if (!isSafePath(filePath)) {
        failed.push({ path: filePath, error: "Invalid path" });
        continue;
      }
      const oldFull = join(GAME_ASSETS_DIR, filePath);
      try {
        assertInsideDir(GAME_ASSETS_DIR, oldFull);
      } catch {
        failed.push({ path: filePath, error: "Path escapes game assets directory" });
        continue;
      }
      if (!existsSync(oldFull)) {
        failed.push({ path: filePath, error: "File not found" });
        continue;
      }
      const stat = statSync(oldFull);
      if (!stat.isFile()) {
        failed.push({ path: filePath, error: "Not a file" });
        continue;
      }
      const safeName = uniqueFilename(destDir, basename(filePath));
      const newFull = join(destDir, safeName);
      copyFileSync(oldFull, newFull);
      succeeded.push(filePath);
    }

    if (succeeded.length > 0) buildAssetManifest();
    return { succeeded, failed, targetFolder };
  });

  // ── POST /game-assets/delete-bulk ──
  app.post("/delete-bulk", async (req, reply) => {
    const schema = z.object({
      paths: z.array(z.string().min(1).max(500)).min(1).max(100),
    });
    const { paths } = schema.parse(req.body);

    const succeeded: string[] = [];
    const failed: { path: string; error: string }[] = [];
    const { unlinkSync } = await import("fs");

    for (const filePath of paths) {
      if (!isSafePath(filePath)) {
        failed.push({ path: filePath, error: "Invalid path" });
        continue;
      }
      const full = join(GAME_ASSETS_DIR, filePath);
      try {
        assertInsideDir(GAME_ASSETS_DIR, full);
      } catch {
        failed.push({ path: filePath, error: "Path escapes game assets directory" });
        continue;
      }
      if (!existsSync(full)) {
        failed.push({ path: filePath, error: "File not found" });
        continue;
      }
      const stat = statSync(full);
      if (!stat.isFile()) {
        failed.push({ path: filePath, error: "Not a file" });
        continue;
      }
      unlinkSync(full);
      succeeded.push(filePath);
    }

    if (succeeded.length > 0) buildAssetManifest();
    return { succeeded, failed };
  });

  // ── GET /game-assets/file-content/* ──
  app.get("/file-content/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(GAME_ASSETS_DIR, wildcard);
    try {
      assertInsideDir(GAME_ASSETS_DIR, filePath);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return reply.status(400).send({ error: "Not a file" });
    }

    const ext = extname(wildcard).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      return reply.status(400).send({ error: "Not a text file" });
    }

    const content = readFileSync(filePath, "utf-8");
    return { content };
  });

  // ── PUT /game-assets/file-content/* ──
  app.put("/file-content/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(GAME_ASSETS_DIR, wildcard);
    try {
      assertInsideDir(GAME_ASSETS_DIR, filePath);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    const body = req.body as { content?: string };
    if (typeof body.content !== "string") {
      return reply.status(400).send({ error: "Missing content" });
    }
    if (Buffer.byteLength(body.content, "utf-8") > MAX_TEXT_BYTES) {
      return reply.status(413).send({ error: `File too large (max ${MAX_TEXT_BYTES} bytes)` });
    }

    const ext = extname(wildcard).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      return reply.status(400).send({ error: "Not a text file" });
    }

    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    writeFileSync(filePath, body.content, "utf-8");
    return { saved: wildcard };
  });

  // ── GET /game-assets/file-info/* ──
  app.get("/file-info/*", async (req, reply) => {
    const wildcard = (req.params as Record<string, string>)["*"];
    if (!wildcard || !isSafePath(wildcard)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(GAME_ASSETS_DIR, wildcard);
    try {
      assertInsideDir(GAME_ASSETS_DIR, filePath);
    } catch {
      return reply.status(400).send({ error: "Path escapes game assets directory" });
    }

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const stat = statSync(filePath);
    const info: Record<string, unknown> = {
      name: basename(filePath),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
    };

    if (stat.isFile()) {
      const ext = extname(wildcard).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        try {
          const metadata = await sharp(filePath).metadata();
          info.width = metadata.width;
          info.height = metadata.height;
          info.format = metadata.format;
        } catch {
          // ignore sharp errors
        }
      }
    }

    return info;
  });
}
