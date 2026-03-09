// ──────────────────────────────────────────────
// Routes: Custom font file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, createReadStream } from "fs";
import { readdir } from "fs/promises";
import { join, extname, basename } from "path";
import { execFile } from "child_process";
import { platform } from "os";

const FONTS_DIR = join(process.cwd(), "data", "fonts");

const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

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
      if (err) console.warn("Could not open fonts folder:", err.message);
    });
    return reply.send({ ok: true, path: FONTS_DIR });
  });
}
