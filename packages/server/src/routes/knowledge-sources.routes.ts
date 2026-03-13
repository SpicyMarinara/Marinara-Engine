// ──────────────────────────────────────────────
// Routes: Knowledge Sources (file uploads for Knowledge Retrieval agent)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { join, extname, basename } from "path";
import { mkdir, readFile, unlink, writeFile, stat } from "fs/promises";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";

const SOURCES_DIR = join(process.cwd(), "data", "knowledge-sources");
const META_FILE = join(SOURCES_DIR, "meta.json");

// Supported text-based formats (read as UTF-8)
const TEXT_EXTS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml", ".tsv"]);
// PDF support via pdf-parse
const PDF_EXTS = new Set([".pdf"]);
const ALLOWED_EXTS = new Set([...TEXT_EXTS, ...PDF_EXTS]);

interface SourceMeta {
  id: string;
  originalName: string;
  filename: string;
  size: number;
  uploadedAt: string;
}

type MetaStore = Record<string, SourceMeta>;

function ensureDir() {
  if (!existsSync(SOURCES_DIR)) {
    mkdirSync(SOURCES_DIR, { recursive: true });
  }
}

function readMeta(): MetaStore {
  if (!existsSync(META_FILE)) return {};
  try {
    return JSON.parse(readFileSync(META_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// Simple in-process queue to serialize writes to META_FILE and avoid
// concurrent write operations that could corrupt or overwrite metadata.
let metaWriteChain: Promise<void> = Promise.resolve();

async function writeMeta(meta: MetaStore) {
  metaWriteChain = metaWriteChain.then(
    async () => {
      await writeFile(META_FILE, JSON.stringify(meta, null, 2), "utf-8");
    },
    // On error, reset the chain but rethrow to propagate the failure
    async () => {
      await writeFile(META_FILE, JSON.stringify(meta, null, 2), "utf-8");
    }
  );

  await metaWriteChain;
}

/**
 * Extract plain text from a file based on its extension.
 */
export async function extractFileText(filePath: string): Promise<string> {
  // Ensure the resolved path is within SOURCES_DIR (defense-in-depth)
  const { resolve, sep } = await import("path");
  const resolved = resolve(filePath);
  const root = resolve(SOURCES_DIR);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return "";
  }

  const ext = extname(filePath).toLowerCase();

  if (TEXT_EXTS.has(ext)) {
    return readFile(filePath, "utf-8");
  }

  if (PDF_EXTS.has(ext)) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const buf = await readFile(filePath);
      const pdf = new PDFParse({ data: new Uint8Array(buf) });
      const result = await pdf.getText();
      await pdf.destroy();
      return result.text;
    } catch {
      return "[PDF text extraction failed]";
    }
  }

  return "";
}

export async function knowledgeSourcesRoutes(app: FastifyInstance) {
  // ── List all uploaded sources ──
  app.get("/", async () => {
    ensureDir();
    const meta = readMeta();
    return Object.values(meta).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  });

  // ── Upload a new source file ──
  app.post("/upload", async (req, reply) => {
    await mkdir(SOURCES_DIR, { recursive: true });
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return reply.status(400).send({
        error: `Unsupported file type: ${ext}. Supported: ${[...ALLOWED_EXTS].join(", ")}`,
      });
    }

    const id = nanoid();
    const filename = `${id}${ext}`;
    const filePath = join(SOURCES_DIR, filename);

    await pipeline(data.file, createWriteStream(filePath));

    const fileInfo = await stat(filePath);
    const meta = readMeta();
    const entry: SourceMeta = {
      id,
      originalName: basename(data.filename),
      filename,
      size: fileInfo.size,
      uploadedAt: new Date().toISOString(),
    };
    meta[id] = entry;
    await writeMeta(meta);

    return entry;
  });

  // ── Delete a source file ──
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { id } = req.params;
    const meta = readMeta();
    const entry = meta[id];
    if (!entry) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const filePath = join(SOURCES_DIR, entry.filename);
    try {
      await unlink(filePath);
    } catch {
      /* file may already be gone */
    }
    delete meta[id];
    await writeMeta(meta);
    return { success: true };
  });

  // ── Get text content of a source (for preview / debugging) ──
  app.get<{ Params: { id: string } }>("/:id/text", async (req, reply) => {
    const { id } = req.params;
    const meta = readMeta();
    const entry = meta[id];
    if (!entry) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const filePath = join(SOURCES_DIR, entry.filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found on disk" });
    }

    const text = await extractFileText(filePath);
    return { id, originalName: entry.originalName, text };
  });
}
