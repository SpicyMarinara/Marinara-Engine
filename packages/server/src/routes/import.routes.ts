// ──────────────────────────────────────────────
// Routes: Import (SillyTavern data)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { execFile } from "child_process";
import { platform, homedir } from "os";
import { readdir, stat } from "fs/promises";
import { relative, resolve as pathResolve, sep } from "path";
import { importSTChat } from "../services/import/st-chat.importer.js";
import { importSTCharacter, importCharX } from "../services/import/st-character.importer.js";
import { importSTPreset } from "../services/import/st-prompt.importer.js";
import { importSTLorebook } from "../services/import/st-lorebook.importer.js";
import { importMarinara } from "../services/import/marinara.importer.js";
import { scanSTFolder, runSTBulkImport, type STBulkImportOptions } from "../services/import/st-bulk.importer.js";
import { characters as charactersTable } from "../db/schema/index.js";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";
import { getImportAllowedRoots } from "../config/runtime-config.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { assertInsideDir, safeCompareString, tokenForPath } from "../utils/security.js";

const PICK_FOLDER_TIMEOUT_MS = 60_000; // 60s — prevents infinite hang on headless servers
const FOLDER_TOKEN_TTL_MS = 15 * 60_000;

const folderTokens = new Map<string, { path: string; expiresAt: number }>();

function cleanupFolderTokens() {
  const now = Date.now();
  for (const [token, entry] of folderTokens) {
    if (entry.expiresAt < now) folderTokens.delete(token);
  }
}

function issueFolderToken(pathValue: string) {
  cleanupFolderTokens();
  const resolved = pathResolve(pathValue);
  const token = tokenForPath(`${resolved}:${Date.now()}:${Math.random()}`);
  folderTokens.set(token, { path: resolved, expiresAt: Date.now() + FOLDER_TOKEN_TTL_MS });
  return token;
}

function isUnderRoot(pathValue: string, root: string): boolean {
  const resolvedRoot = pathResolve(root);
  const resolvedPath = pathResolve(pathValue);
  const rel = relative(resolvedRoot, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function isAllowedImportRoot(pathValue: string) {
  return getImportAllowedRoots().some((root) => isUnderRoot(pathValue, root));
}

function isHomeContained(pathValue: string) {
  try {
    assertInsideDir(homedir(), pathResolve(pathValue));
    return true;
  } catch {
    return false;
  }
}

function resolveImportFolder(body: { folderPath?: unknown; folderToken?: unknown }): { ok: true; path: string } | { ok: false; error: string } {
  const rawPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
  const token = typeof body.folderToken === "string" ? body.folderToken.trim() : "";
  cleanupFolderTokens();

  if (token) {
    const entry = folderTokens.get(token);
    if (!entry) return { ok: false, error: "Folder token is missing or expired" };
    if (rawPath && !safeCompareString(pathResolve(rawPath), entry.path)) {
      return { ok: false, error: "Folder token does not match folderPath" };
    }
    return { ok: true, path: entry.path };
  }

  if (!rawPath) return { ok: false, error: "folderPath or folderToken is required" };
  const resolved = pathResolve(rawPath);
  if (!isAllowedImportRoot(resolved)) {
    return { ok: false, error: "folderPath is not allowed. Use the folder picker/browser or set IMPORT_ALLOWED_ROOTS." };
  }
  return { ok: true, path: resolved };
}

/**
 * Opens a native OS folder picker and returns the selected path.
 * macOS  → osascript
 * Linux  → zenity / kdialog
 * Windows → PowerShell
 * Times out after 60s to prevent hanging on headless/remote machines.
 */
function pickFolder(): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    const timer = setTimeout(() => done(null), PICK_FOLDER_TIMEOUT_MS);
    const cleanup = () => clearTimeout(timer);

    const os = platform();

    if (os === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Select your SillyTavern folder")'],
        (err, stdout) => {
          cleanup();
          if (err) return done(null);
          const p = stdout.trim().replace(/\/$/, "");
          done(p || null);
        },
      );
    } else if (os === "win32") {
      // -STA is required for WinForms dialogs. A hidden topmost form is created
      // as the owner window so the dialog appears in the foreground instead of
      // flashing and closing immediately (common Node.js-spawned-PowerShell bug).
      const ps = [
        "-STA",
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms;` +
          `$f = New-Object System.Windows.Forms.Form;` +
          `$f.TopMost = $true;` +
          `$f.WindowState = 'Minimized';` +
          `$f.ShowInTaskbar = $false;` +
          `$f.Show();` +
          `$f.Hide();` +
          `$d = New-Object System.Windows.Forms.FolderBrowserDialog;` +
          `$d.Description = 'Select your SillyTavern folder';` +
          `if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath } else { '' };` +
          `$f.Dispose()`,
      ];
      execFile("powershell.exe", ps, (err, stdout) => {
        cleanup();
        if (err) return done(null);
        const p = stdout.trim();
        done(p || null);
      });
    } else {
      // Linux — try zenity first, then kdialog
      execFile(
        "zenity",
        ["--file-selection", "--directory", "--title=Select your SillyTavern folder"],
        (err, stdout) => {
          if (!err && stdout.trim()) {
            cleanup();
            return done(stdout.trim());
          }
          execFile(
            "kdialog",
            ["--getexistingdirectory", ".", "--title", "Select your SillyTavern folder"],
            (err2, stdout2) => {
              cleanup();
              if (err2) return done(null);
              const p = stdout2.trim();
              done(p || null);
            },
          );
        },
      );
    }
  });
}

/** Read PNG tEXt chunk with keyword "chara" → base64-encoded JSON character data */
const CHARA_KEYWORDS = new Set(["ccv3", "chara"]);

/** Extract character JSON from a PNG buffer, checking tEXt and iTXt chunks for "ccv3" (V3) or "chara" (V2) keywords. */
function extractCharaFromPng(buf: Buffer): Record<string, unknown> | null {
  if (buf.length < 8) return null;
  const found = new Map<string, Record<string, unknown>>();
  let offset = 8; // skip PNG signature

  while (offset < buf.length - 8) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const payload = buf.subarray(offset + 8, offset + 8 + length);

    if (type === "tEXt") {
      const nullIdx = payload.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = payload.subarray(0, nullIdx).toString("ascii");
        if (CHARA_KEYWORDS.has(keyword) && !found.has(keyword)) {
          const b64 = payload.subarray(nullIdx + 1).toString("ascii");
          try {
            const json = Buffer.from(b64, "base64").toString("utf-8");
            found.set(keyword, JSON.parse(json));
          } catch {
            /* skip malformed */
          }
        }
      }
    } else if (type === "iTXt") {
      const nullIdx = payload.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = payload.subarray(0, nullIdx).toString("ascii");
        if (CHARA_KEYWORDS.has(keyword) && !found.has(keyword)) {
          const compressionFlag = payload[nullIdx + 1];
          // Skip compressionMethod, then find languageTag\0 and translatedKeyword\0
          const langEnd = payload.indexOf(0, nullIdx + 3);
          if (langEnd >= 0) {
            const transEnd = payload.indexOf(0, langEnd + 1);
            if (transEnd >= 0) {
              const textBuf = payload.subarray(transEnd + 1);
              if (compressionFlag === 0) {
                const text = textBuf.toString("utf-8");
                try {
                  // iTXt may be raw JSON or base64-encoded
                  found.set(keyword, JSON.parse(text));
                } catch {
                  try {
                    const decoded = Buffer.from(text, "base64").toString("utf-8");
                    found.set(keyword, JSON.parse(decoded));
                  } catch {
                    /* skip */
                  }
                }
              }
            }
          }
        }
      }
    }

    offset += 12 + length;
    if (type === "IEND") break;
  }

  // Prefer ccv3 (V3 full data) over chara (V2 / backward-compat)
  return found.get("ccv3") ?? found.get("chara") ?? null;
}

function readTimestampOverridesValue(value: unknown) {
  if (typeof value === "string") {
    try {
      return normalizeTimestampOverrides(JSON.parse(value));
    } catch {
      return normalizeTimestampOverrides({ createdAt: value, updatedAt: value });
    }
  }
  if (value && typeof value === "object") {
    return normalizeTimestampOverrides(value as Record<string, unknown>);
  }
  return undefined;
}

function readTimestampOverridesFromBody(body: Record<string, unknown>) {
  return (
    readTimestampOverridesValue(body.timestampOverrides ?? body.__timestampOverrides) ??
    normalizeTimestampOverrides({
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
    })
  );
}

function readTimestampOverridesFromMultipart(file: { fields?: Record<string, any> } | null | undefined) {
  const field = file?.fields?.timestampOverrides ?? file?.fields?.__timestampOverrides;
  const rawValue = Array.isArray(field) ? field.at(-1)?.value : field?.value;
  return readTimestampOverridesValue(rawValue);
}

async function importCharacterBuffer(
  fileName: string,
  buffer: Buffer,
  db: FastifyInstance["db"],
  timestampOverrides?: ReturnType<typeof normalizeTimestampOverrides>,
) {
  if (fileName.toLowerCase().endsWith(".png")) {
    const charData = extractCharaFromPng(buffer);
    if (!charData) {
      return {
        success: false,
        error: "No character data found in PNG. Make sure this is a valid character card with embedded metadata.",
      };
    }

    const avatarB64 = buffer.toString("base64");
    charData._avatarDataUrl = `data:image/png;base64,${avatarB64}`;
    return importSTCharacter(charData, db, { timestampOverrides });
  }

  if (fileName.toLowerCase().endsWith(".charx")) {
    return importCharX(buffer, db, { timestampOverrides });
  }

  try {
    const json = JSON.parse(buffer.toString("utf-8"));
    return importSTCharacter(json, db, { timestampOverrides });
  } catch {
    return {
      success: false,
      error:
        "Invalid file format. Expected a JSON character card, a PNG with embedded character data, or a .charx file.",
    };
  }
}

export async function importRoutes(app: FastifyInstance) {
  /** Import a SillyTavern JSONL chat file. */
  app.post("/st-chat", async (req) => {
    const data = await req.file();
    if (!data) return { error: "No file uploaded" };
    const content = await data.toBuffer();
    const text = content.toString("utf-8");
    const timestampOverrides = readTimestampOverridesFromMultipart(data as any);

    // Use the uploaded filename (minus extension) as chat name if available
    const rawName = data.filename ?? "";
    const chatName =
      rawName
        .replace(/\.jsonl$/i, "")
        .replace(/_/g, " ")
        .trim() || undefined;

    // Try to link the chat to a character by matching the JSONL header's character_name
    let characterId: string | null = null;
    try {
      const firstLine = text.split("\n")[0];
      if (firstLine) {
        const header = JSON.parse(firstLine);
        const headerName = (header.character_name ?? "").toLowerCase().trim();
        if (headerName) {
          const allChars = await app.db.select().from(charactersTable);
          for (const ch of allChars) {
            try {
              const charData = JSON.parse(ch.data);
              if ((charData?.name ?? "").toLowerCase().trim() === headerName) {
                characterId = ch.id;
                break;
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch {
      // header parse failed — import without character link
    }

    return importSTChat(text, app.db, {
      ...(chatName ? { chatName } : {}),
      ...(characterId ? { characterId } : {}),
      ...(timestampOverrides ? { timestampOverrides } : {}),
    });
  });

  /** Import a Marinara Engine export (.marinara.json). */
  app.post("/marinara", async (req) => {
    const body = req.body as Record<string, unknown>;
    const timestampOverrides = readTimestampOverridesFromBody(body);
    const payload =
      timestampOverrides && body.data && typeof body.data === "object"
        ? {
            ...body,
            data: {
              ...(body.data as Record<string, unknown>),
              metadata: {
                ...(((body.data as Record<string, unknown>).metadata &&
                typeof (body.data as Record<string, unknown>).metadata === "object"
                  ? ((body.data as Record<string, unknown>).metadata as Record<string, unknown>)
                  : {}) as Record<string, unknown>),
                timestamps: timestampOverrides,
              },
            },
          }
        : body;
    return importMarinara(payload as any, app.db);
  });

  /** Import a SillyTavern character (JSON body or PNG file upload). */
  app.post("/st-character", async (req) => {
    const contentType = req.headers["content-type"] ?? "";

    // Handle multipart file upload (PNG character cards)
    if (contentType.includes("multipart/form-data")) {
      const file = await req.file();
      if (!file) return { success: false, error: "No file uploaded" };
      const timestampOverrides = readTimestampOverridesFromMultipart(file as any);
      return importCharacterBuffer(file.filename ?? "", await file.toBuffer(), app.db, timestampOverrides);
    }

    // Standard JSON body
    const body = req.body as Record<string, unknown>;
    return importSTCharacter(body, app.db, { timestampOverrides: readTimestampOverridesFromBody(body) });
  });

  /** Import multiple character cards in one multipart request. */
  app.post("/st-character/batch", async (req) => {
    const parts = req.parts();
    const files: Array<{ filename: string; buffer: Buffer }> = [];
    const timestampEntries: Array<{ name?: string; lastModified?: number | string }> = [];

    for await (const part of parts) {
      if (part.type === "file") {
        files.push({
          filename: part.filename ?? "character",
          buffer: await part.toBuffer(),
        });
        continue;
      }

      if (part.fieldname === "fileTimestamps") {
        try {
          const parsed = JSON.parse(String(part.value ?? "[]"));
          if (Array.isArray(parsed)) {
            timestampEntries.push(...parsed);
          }
        } catch {
          // ignore malformed metadata and continue importing
        }
      }
    }

    if (files.length === 0) {
      return { success: false, error: "No files uploaded", results: [] };
    }

    const timestampsByName = new Map<string, Array<{ lastModified?: number | string }>>();
    for (const entry of timestampEntries) {
      if (!entry.name) continue;
      const queue = timestampsByName.get(entry.name) ?? [];
      queue.push(entry);
      timestampsByName.set(entry.name, queue);
    }

    const results = [];
    for (const file of files) {
      const timestampEntry = timestampsByName.get(file.filename)?.shift();
      const timestampOverrides = normalizeTimestampOverrides({
        createdAt: timestampEntry?.lastModified,
        updatedAt: timestampEntry?.lastModified,
      });
      try {
        const result = await importCharacterBuffer(file.filename, file.buffer, app.db, timestampOverrides);
        results.push({ filename: file.filename, ...result });
      } catch (error) {
        results.push({
          filename: file.filename,
          success: false,
          error: error instanceof Error ? error.message : "Import failed",
        });
      }
    }

    return {
      success: results.some((result) => result.success),
      results,
    };
  });

  /** Import a SillyTavern prompt preset (JSON body). */
  app.post("/st-preset", async (req) => {
    const body = req.body as Record<string, unknown>;
    const fileName = typeof body.__filename === "string" ? body.__filename : undefined;
    return importSTPreset(body, app.db, fileName, { timestampOverrides: readTimestampOverridesFromBody(body) });
  });

  /** Import a SillyTavern World Info / lorebook (JSON body). */
  app.post("/st-lorebook", async (req) => {
    const body = req.body as Record<string, unknown>;
    const fallbackName = typeof body.__filename === "string" ? body.__filename : undefined;
    return importSTLorebook(body, app.db, {
      ...(fallbackName ? { fallbackName } : {}),
      timestampOverrides: readTimestampOverridesFromBody(body),
    });
  });

  // ═══════════════════════════════════════════════
  // Bulk Import: Scan + Run from a local ST folder
  // ═══════════════════════════════════════════════

  /** Scan a SillyTavern installation folder, return counts of importable data. */
  app.post("/st-bulk/scan", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "SillyTavern bulk import scan" })) return;
    const resolved = resolveImportFolder(req.body as { folderPath?: unknown; folderToken?: unknown });
    if (!resolved.ok) return { success: false, error: resolved.error };
    return scanSTFolder(resolved.path);
  });

  /** Run a bulk import from a SillyTavern installation folder (SSE stream with progress). */
  app.post("/st-bulk/run", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "SillyTavern bulk import" })) return;
    const { options } = req.body as {
      folderPath?: string;
      folderToken?: string;
      options: STBulkImportOptions;
    };
    const resolved = resolveImportFolder(req.body as { folderPath?: unknown; folderToken?: unknown });
    if (!resolved.ok) return reply.send({ success: false, error: resolved.error });

    // Set up SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runSTBulkImport(resolved.path, options, app.db, (progress) => {
        sendEvent("progress", progress);
      });
      sendEvent("done", result);
    } catch (err) {
      sendEvent("done", { success: false, error: (err as Error).message, imported: {}, errors: [] });
    }
    reply.raw.end();
  });

  /** Open a native OS folder picker dialog and return the selected path. */
  app.post("/pick-folder", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Folder picker" })) return;
    const selected = await pickFolder();
    if (!selected) return { success: false, error: "No folder selected" };
    return { success: true, path: selected, folderToken: issueFolderToken(selected) };
  });

  /** List directories at a given path (for remote/headless folder browsing).
   *  Restricted to subdirectories of the user's home directory to prevent
   *  arbitrary filesystem enumeration. */
  app.post<{ Body: { path?: string } }>("/list-directory", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Folder browser" })) return;
    const home = homedir();
    const requestedPath = (req.body?.path || "").trim();
    const dirPath = requestedPath || home;
    const resolved = pathResolve(dirPath);

    // Restrict browsing to the home directory tree
    if (!isHomeContained(resolved)) {
      return { success: false, error: "Access denied: path outside home directory" };
    }

    try {
      const info = await stat(resolved);
      if (!info.isDirectory()) return { success: false, error: "Not a directory" };

      const entries = await readdir(resolved, { withFileTypes: true });
      const folders = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      return { success: true, path: resolved, folderToken: issueFolderToken(resolved), folders };
    } catch {
      return { success: false, error: "Cannot read directory" };
    }
  });
}
