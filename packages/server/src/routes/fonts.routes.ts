// ──────────────────────────────────────────────
// Routes: Custom font file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { existsSync, mkdirSync, createReadStream } from "fs";
import { readdir, writeFile } from "fs/promises";
import { join, extname, basename } from "path";
import { execFile } from "child_process";
import { platform } from "os";
import { DATA_DIR } from "../utils/data-dir.js";

const FONTS_DIR = join(DATA_DIR, "fonts");

const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

/** Max font file size: 10 MB */
const MAX_FONT_BYTES = 10 * 1024 * 1024;

/** Tracks in-progress downloads to prevent duplicate concurrent requests */
const downloadingFonts = new Set<string>();

const MIME_MAP: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function ensureDir() {
  if (!existsSync(FONTS_DIR)) {
    mkdirSync(FONTS_DIR, { recursive: true });
  }
}

/** Derive a display name from a font filename: "Roboto-Regular.woff2" → "Roboto" */
function fontDisplayName(filename: string): string {
  const name = basename(filename, extname(filename));
  return (
    name
      // Strip common weight/style suffixes
      .replace(/[-_](Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|BoldItalic|Variable.*)/gi, "")
      // Split camelCase: "OpenSans" → "Open Sans"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Split acronym + word: "EBGaramond" → "EB Garamond", "NotoSans" stays as "Noto Sans"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // Split number→letter and letter→number: "Source3" → "Source 3"
      .replace(/([a-zA-Z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-zA-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .trim()
  );
}

export async function fontsRoutes(app: FastifyInstance) {
  /** List available custom fonts from data/fonts/ */
  app.get("/", async () => {
    ensureDir();
    const entries = await readdir(FONTS_DIR, { withFileTypes: true });
    const fonts: { filename: string; family: string; url: string }[] = [];

    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (!FONT_EXTS.has(ext)) continue;
      fonts.push({
        filename: e.name,
        family: fontDisplayName(e.name),
        url: `/api/fonts/file/${encodeURIComponent(e.name)}`,
      });
    }

    // Deduplicate by family name (keep first occurrence)
    const seen = new Set<string>();
    const unique: typeof fonts = [];
    for (const f of fonts) {
      if (!seen.has(f.family)) {
        seen.add(f.family);
        unique.push(f);
      }
    }

    return unique;
  });

  /** Serve a font file */
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    // Prevent path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const ext = extname(filename).toLowerCase();
    if (!FONT_EXTS.has(ext)) {
      return reply.status(400).send({ error: "Not a font file" });
    }

    const filePath = join(FONTS_DIR, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /** Open the data/fonts folder in the native file explorer */
  app.post("/open-folder", async (_req, reply) => {
    ensureDir();
    const os = platform();
    const cmd = os === "darwin" ? "open" : os === "win32" ? "explorer" : "xdg-open";
    execFile(cmd, [FONTS_DIR], (err) => {
      if (err) logger.warn("Could not open fonts folder: %s", err.message);
    });
    return reply.send({ ok: true, path: FONTS_DIR });
  });

  /** Download a font from Google Fonts and save to data/fonts/ */
  app.post("/google/download", async (req, reply) => {
    const { family } = req.body as { family?: string };

    if (!family || typeof family !== "string") {
      return reply.status(400).send({ error: "Font family name is required" });
    }

    const sanitized = family.trim();
    if (!sanitized || sanitized.length > 100 || !/^[a-zA-Z0-9 ]+$/.test(sanitized)) {
      return reply.status(400).send({ error: "Invalid font family name. Use only letters, numbers, and spaces." });
    }

    // Check if already installed
    const safeName = sanitized.replace(/ /g, "");
    const targetFile = `${safeName}-Regular.woff2`;
    const targetPath = join(FONTS_DIR, targetFile);
    if (existsSync(targetPath)) {
      return reply.status(409).send({ error: `"${sanitized}" is already installed` });
    }

    // Prevent concurrent downloads of the same font
    if (downloadingFonts.has(safeName)) {
      return reply.status(409).send({ error: `"${sanitized}" is already being downloaded` });
    }
    downloadingFonts.add(safeName);

    try {
      // Fetch the CSS from Google Fonts (woff2 format via modern user-agent)
      const encodedFamily = encodeURIComponent(sanitized);
      const cssUrl = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400&display=swap`;

      let css: string;
      try {
        const cssRes = await fetch(cssUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!cssRes.ok) {
          return reply.status(404).send({ error: `Font "${sanitized}" not found on Google Fonts` });
        }
        css = await cssRes.text();
      } catch {
        return reply.status(502).send({ error: "Could not reach Google Fonts. Check your internet connection." });
      }

      // Extract woff2 URL — only allow fonts.gstatic.com to prevent SSRF
      const urlMatches = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/s\/[^\s)]+\.woff2)\)/g)];
      if (urlMatches.length === 0) {
        return reply
          .status(404)
          .send({ error: `Font "${sanitized}" not found on Google Fonts, or has no regular (400) weight available` });
      }

      // Take the last match (latin subset)
      const lastMatch = urlMatches[urlMatches.length - 1];
      const fontFileUrl = lastMatch?.[1];
      if (!fontFileUrl) {
        return reply.status(500).send({ error: "Could not extract font file from Google Fonts response" });
      }

      // Download the actual font file with size limit
      let buffer: Buffer;
      try {
        const fontRes = await fetch(fontFileUrl, { signal: AbortSignal.timeout(30_000) });
        if (!fontRes.ok) {
          return reply.status(502).send({ error: "Failed to download font file" });
        }

        const contentLength = Number(fontRes.headers.get("content-length") || 0);
        if (contentLength > MAX_FONT_BYTES) {
          return reply.status(413).send({ error: "Font file is too large (max 10 MB)" });
        }

        buffer = Buffer.from(await fontRes.arrayBuffer());
        if (buffer.length > MAX_FONT_BYTES) {
          return reply.status(413).send({ error: "Font file is too large (max 10 MB)" });
        }
      } catch {
        return reply.status(502).send({ error: "Failed to download font file. Check your internet connection." });
      }

      // Validate woff2 magic bytes ("wOF2")
      if (buffer.length < 4 || buffer[0] !== 0x77 || buffer[1] !== 0x4f || buffer[2] !== 0x46 || buffer[3] !== 0x32) {
        return reply.status(502).send({ error: "Downloaded file is not a valid woff2 font" });
      }

      // Save to fonts directory
      ensureDir();
      await writeFile(targetPath, buffer);

      return {
        filename: targetFile,
        family: fontDisplayName(targetFile),
        url: `/api/fonts/file/${encodeURIComponent(targetFile)}`,
      };
    } finally {
      downloadingFonts.delete(safeName);
    }
  });
}
