// ──────────────────────────────────────────────
// Routes: Custom font file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { existsSync, mkdirSync, createReadStream } from "fs";
import { readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { join, extname, basename } from "path";
import { execFile } from "child_process";
import { platform } from "os";
import { DATA_DIR } from "../utils/data-dir.js";

const FONTS_DIR = join(DATA_DIR, "fonts");
const FONT_METADATA_FILE = join(FONTS_DIR, "font-metadata.json");

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

interface FontMetadataEntry {
  family: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
  source?: "google";
}

interface CustomFontFace {
  filename: string;
  family: string;
  url: string;
  weight: string;
  style: string;
  unicodeRange?: string;
}

interface GoogleFontFace {
  url: string;
  weight: string;
  style: string;
  unicodeRange?: string;
}

interface GoogleCssResult {
  css: string | null;
  reachedGoogle: boolean;
}

interface DownloadedFontFile {
  filename: string;
  face: GoogleFontFace;
  buffer: Buffer;
}

function ensureDir() {
  if (!existsSync(FONTS_DIR)) {
    mkdirSync(FONTS_DIR, { recursive: true });
  }
}

/** Derive a display name from a font filename: "Roboto-Regular.woff2" → "Roboto" */
export function fontDisplayName(filename: string): string {
  const name = basename(filename, extname(filename));
  return (
    name
      // Strip Marinara-downloaded Google Fonts shard suffixes.
      .replace(
        /[-_](Regular|BoldItalic|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|Variable.*)[-_]\d{3}$/i,
        "",
      )
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

function normalizeMetadataEntry(value: unknown): FontMetadataEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Partial<FontMetadataEntry>;
  if (typeof entry.family !== "string" || !entry.family.trim()) return null;
  return {
    family: entry.family.trim(),
    weight: typeof entry.weight === "string" && entry.weight.trim() ? entry.weight.trim() : undefined,
    style: typeof entry.style === "string" && entry.style.trim() ? entry.style.trim() : undefined,
    unicodeRange:
      typeof entry.unicodeRange === "string" && entry.unicodeRange.trim() ? entry.unicodeRange.trim() : undefined,
    source: entry.source === "google" ? "google" : undefined,
  };
}

async function readFontMetadata(): Promise<Record<string, FontMetadataEntry>> {
  try {
    const raw = await readFile(FONT_METADATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const metadata: Record<string, FontMetadataEntry> = {};
    for (const [filename, value] of Object.entries(parsed)) {
      const entry = normalizeMetadataEntry(value);
      if (entry) metadata[filename] = entry;
    }
    return metadata;
  } catch {
    return {};
  }
}

async function writeFontMetadata(metadata: Record<string, FontMetadataEntry>) {
  ensureDir();
  const tempFile = `${FONT_METADATA_FILE}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
    await rename(tempFile, FONT_METADATA_FILE);
  } catch (err) {
    await unlink(tempFile).catch(() => {});
    throw err;
  }
}

function inferFontWeight(filename: string): string {
  const base = basename(filename, extname(filename));
  if (/Thin/i.test(base)) return "100";
  if (/ExtraLight|UltraLight/i.test(base)) return "200";
  if (/Light/i.test(base)) return "300";
  if (/Medium/i.test(base)) return "500";
  if (/SemiBold|DemiBold/i.test(base)) return "600";
  if (/ExtraBold|UltraBold/i.test(base)) return "800";
  if (/Black|Heavy/i.test(base)) return "900";
  if (/Bold/i.test(base)) return "700";
  return "400";
}

function inferFontStyle(filename: string): string {
  return /Italic|Oblique/i.test(basename(filename, extname(filename))) ? "italic" : "normal";
}

function stripCssQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === `"` || quote === `'`) && trimmed[trimmed.length - 1] === quote) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function readCssDescriptor(block: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, "i"));
  return match?.[1]?.trim();
}

export function parseGoogleFontFaces(css: string): GoogleFontFace[] {
  const faces: GoogleFontFace[] = [];
  const seen = new Set<string>();
  const blocks = css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g);

  for (const blockMatch of blocks) {
    const block = blockMatch[1] ?? "";
    const url = block.match(/url\((?:"|')?(https:\/\/fonts\.gstatic\.com\/s\/[^\s)"']+\.woff2)(?:"|')?\)/i)?.[1];
    if (!url) continue;

    const weight = stripCssQuotes(readCssDescriptor(block, "font-weight") ?? "400");
    const style = stripCssQuotes(readCssDescriptor(block, "font-style") ?? "normal");
    const unicodeRange = readCssDescriptor(block, "unicode-range");
    const key = `${url}|${weight}|${style}|${unicodeRange ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push({ url, weight, style, unicodeRange });
  }

  return faces;
}

async function fetchGoogleCss(url: string): Promise<GoogleCssResult> {
  try {
    const cssRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!cssRes.ok) return { css: null, reachedGoogle: true };
    return { css: await cssRes.text(), reachedGoogle: true };
  } catch {
    return { css: null, reachedGoogle: false };
  }
}

async function loadGoogleFontFaces(
  family: string,
): Promise<{ faces: GoogleFontFace[] | null; reachedGoogle: boolean }> {
  const encodedFamily = encodeURIComponent(family);
  const css2Url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400&display=swap`;
  const legacyCssUrl = `https://fonts.googleapis.com/css?family=${encodedFamily}:400&display=swap`;

  const css2 = await fetchGoogleCss(css2Url);
  const css2Faces = css2.css ? parseGoogleFontFaces(css2.css) : [];

  // Some CJK families expose the full glyph shards only through the legacy CSS endpoint.
  // Prefer it when it contains a richer face list than css2.
  const legacyCss = await fetchGoogleCss(legacyCssUrl);
  const legacyFaces = legacyCss.css ? parseGoogleFontFaces(legacyCss.css) : [];

  const faces = legacyFaces.length > css2Faces.length ? legacyFaces : css2Faces;
  return {
    faces: faces.length > 0 ? faces : null,
    reachedGoogle: css2.reachedGoogle || legacyCss.reachedGoogle,
  };
}

export function isLegacyManagedGoogleFilename(filename: string, safeName: string) {
  const ext = extname(filename).toLowerCase();
  if (ext !== ".woff2") return false;

  const base = basename(filename, ext).toLowerCase();
  const legacyBase = `${safeName}-Regular`.toLowerCase();
  if (base === legacyBase) return true;
  if (!base.startsWith(`${legacyBase}-`)) return false;
  return /^\d{3}$/.test(base.slice(legacyBase.length + 1));
}

function isManagedGoogleFamilyFile(filename: string, safeName: string, metadata: Record<string, FontMetadataEntry>) {
  const ext = extname(filename).toLowerCase();
  return (
    FONT_EXTS.has(ext) &&
    isLegacyManagedGoogleFilename(filename, safeName) &&
    (metadata[filename]?.source === "google" || !metadata[filename])
  );
}

async function replaceManagedGoogleFontFiles(
  safeName: string,
  family: string,
  metadata: Record<string, FontMetadataEntry>,
  downloaded: DownloadedFontFile[],
) {
  ensureDir();
  const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempFiles: Array<{ target: DownloadedFontFile; tempFilename: string }> = [];
  const backups: Array<{ filename: string; backupFilename: string }> = [];
  const installedTargets: string[] = [];

  try {
    for (const target of downloaded) {
      const tempFilename = `${target.filename}.${operationId}.tmp`;
      tempFiles.push({ target, tempFilename });
      await writeFile(join(FONTS_DIR, tempFilename), target.buffer);
    }

    const entries = await readdir(FONTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isManagedGoogleFamilyFile(entry.name, safeName, metadata)) continue;
      const backupFilename = `${entry.name}.${operationId}.bak`;
      await rename(join(FONTS_DIR, entry.name), join(FONTS_DIR, backupFilename));
      backups.push({ filename: entry.name, backupFilename });
    }

    for (const { target, tempFilename } of tempFiles) {
      await rename(join(FONTS_DIR, tempFilename), join(FONTS_DIR, target.filename));
      installedTargets.push(target.filename);
    }

    const nextMetadata = { ...metadata };
    for (const { filename } of backups) {
      delete nextMetadata[filename];
    }
    for (const item of downloaded) {
      nextMetadata[item.filename] = {
        family,
        weight: item.face.weight,
        style: item.face.style,
        ...(item.face.unicodeRange ? { unicodeRange: item.face.unicodeRange } : {}),
        source: "google",
      };
    }
    await writeFontMetadata(nextMetadata);

    await Promise.all(backups.map(({ backupFilename }) => unlink(join(FONTS_DIR, backupFilename)).catch(() => {})));
  } catch (err) {
    await Promise.all(installedTargets.map((filename) => unlink(join(FONTS_DIR, filename)).catch(() => {})));
    await Promise.all(
      backups.map(({ filename, backupFilename }) =>
        rename(join(FONTS_DIR, backupFilename), join(FONTS_DIR, filename)).catch(() => {}),
      ),
    );
    await Promise.all(tempFiles.map(({ tempFilename }) => unlink(join(FONTS_DIR, tempFilename)).catch(() => {})));
    throw err;
  }
}

export async function fontsRoutes(app: FastifyInstance) {
  /** List available custom fonts from data/fonts/ */
  app.get("/", async () => {
    ensureDir();
    const entries = await readdir(FONTS_DIR, { withFileTypes: true });
    const metadata = await readFontMetadata();
    const managedShardLegacyFiles = new Set(
      Object.entries(metadata)
        .filter(([filename, meta]) => meta.source === "google" && /-Regular-\d{3}\.woff2$/i.test(filename))
        .map(([filename]) => filename.replace(/-Regular-\d{3}\.woff2$/i, "-Regular.woff2")),
    );
    const fonts: CustomFontFace[] = [];

    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (!FONT_EXTS.has(ext)) continue;
      const meta = metadata[e.name];
      if (!meta && managedShardLegacyFiles.has(e.name)) continue;
      fonts.push({
        filename: e.name,
        family: meta?.family ?? fontDisplayName(e.name),
        url: `/api/fonts/file/${encodeURIComponent(e.name)}`,
        weight: meta?.weight ?? inferFontWeight(e.name),
        style: meta?.style ?? inferFontStyle(e.name),
        ...(meta?.unicodeRange ? { unicodeRange: meta.unicodeRange } : {}),
      });
    }

    return fonts.sort((a, b) => a.family.localeCompare(b.family) || a.filename.localeCompare(b.filename));
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
      if (err) logger.warn(err, "Could not open fonts folder");
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

    const safeName = sanitized.replace(/ /g, "");

    // Prevent concurrent downloads of the same font
    if (downloadingFonts.has(safeName)) {
      return reply.status(409).send({ error: `"${sanitized}" is already being downloaded` });
    }
    downloadingFonts.add(safeName);

    try {
      // Fetch the CSS from Google Fonts (woff2 format via modern user-agent).
      // CJK families are often split into many unicode-range shards, so keep all faces.
      const { faces, reachedGoogle } = await loadGoogleFontFaces(sanitized);
      if (!faces) {
        if (!reachedGoogle) {
          return reply.status(502).send({ error: "Could not reach Google Fonts. Check your internet connection." });
        }
        return reply
          .status(404)
          .send({ error: `Font "${sanitized}" not found on Google Fonts, or has no regular (400) weight available` });
      }

      const metadata = await readFontMetadata();
      const faceTargets = faces.map((face, i) => {
        const suffix = faces.length === 1 ? "" : `-${String(i + 1).padStart(3, "0")}`;
        return { face, filename: `${safeName}-Regular${suffix}.woff2` };
      });
      const unmanagedConflict = faceTargets.find(
        ({ filename }) =>
          existsSync(join(FONTS_DIR, filename)) && metadata[filename] && metadata[filename].source !== "google",
      );
      if (unmanagedConflict) {
        return reply.status(409).send({ error: `"${sanitized}" is already installed` });
      }

      const downloaded: Array<{ filename: string; face: GoogleFontFace; buffer: Buffer }> = [];
      for (const target of faceTargets) {
        const { face, filename } = target;
        const fontRes = await fetch(face.url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!fontRes || !fontRes.ok) {
          return reply.status(502).send({ error: "Failed to download font file" });
        }

        const contentLength = Number(fontRes.headers.get("content-length") || 0);
        if (contentLength > MAX_FONT_BYTES) {
          return reply.status(413).send({ error: "Font file is too large (max 10 MB)" });
        }

        const buffer = Buffer.from(await fontRes.arrayBuffer());
        if (buffer.length > MAX_FONT_BYTES) {
          return reply.status(413).send({ error: "Font file is too large (max 10 MB)" });
        }

        // Validate woff2 magic bytes ("wOF2")
        if (buffer.length < 4 || buffer[0] !== 0x77 || buffer[1] !== 0x4f || buffer[2] !== 0x46 || buffer[3] !== 0x32) {
          return reply.status(502).send({ error: "Downloaded file is not a valid woff2 font" });
        }

        downloaded.push({ filename, face, buffer });
      }

      await replaceManagedGoogleFontFiles(safeName, sanitized, metadata, downloaded);

      const files = downloaded.map(({ filename, face }) => ({
        filename,
        family: sanitized,
        url: `/api/fonts/file/${encodeURIComponent(filename)}`,
        weight: face.weight,
        style: face.style,
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      }));

      return {
        filename: files[0]?.filename ?? `${safeName}-Regular.woff2`,
        family: sanitized,
        url: files[0]?.url ?? `/api/fonts/file/${encodeURIComponent(`${safeName}-Regular.woff2`)}`,
        files,
      };
    } finally {
      downloadingFonts.delete(safeName);
    }
  });
}
