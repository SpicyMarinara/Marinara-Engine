// ──────────────────────────────────────────────
// Routes: Import (SillyTavern data)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { execFile } from "child_process";
import { platform } from "os";
import { importSTChat } from "../services/import/st-chat.importer.js";
import { importSTCharacter } from "../services/import/st-character.importer.js";
import { importSTPreset } from "../services/import/st-prompt.importer.js";
import { importSTLorebook } from "../services/import/st-lorebook.importer.js";
import { importMarinara } from "../services/import/marinara.importer.js";
import { scanSTFolder, runSTBulkImport, type STBulkImportOptions } from "../services/import/st-bulk.importer.js";

const PICK_FOLDER_TIMEOUT_MS = 60_000; // 60s — prevents infinite hang on headless servers

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

export async function importRoutes(app: FastifyInstance) {
  /** Import a SillyTavern JSONL chat file. */
  app.post("/st-chat", async (req) => {
    const data = await req.file();
    if (!data) return { error: "No file uploaded" };
    const content = await data.toBuffer();

    // Use the uploaded filename (minus extension) as chat name if available
    const rawName = data.filename ?? "";
    const chatName =
      rawName
        .replace(/\.jsonl$/i, "")
        .replace(/_/g, " ")
        .trim() || undefined;

    return importSTChat(content.toString("utf-8"), app.db, chatName ? { chatName } : undefined);
  });

  /** Import a Marinara Engine export (.marinara.json). */
  app.post("/marinara", async (req) => {
    return importMarinara(req.body as any, app.db);
  });

  /** Import a SillyTavern character (JSON body or PNG file upload). */
  app.post("/st-character", async (req) => {
    const contentType = req.headers["content-type"] ?? "";

    // Handle multipart file upload (PNG character cards)
    if (contentType.includes("multipart/form-data")) {
      const file = await req.file();
      if (!file) return { success: false, error: "No file uploaded" };

      const buf = await file.toBuffer();
      const filename = file.filename ?? "";

      if (filename.toLowerCase().endsWith(".png")) {
        // Extract character data from PNG tEXt chunk
        const charData = extractCharaFromPng(buf);
        if (!charData) {
          return {
            success: false,
            error: "No character data found in PNG. Make sure this is a valid character card with embedded metadata.",
          };
        }

        // Attach the PNG itself as avatar data URL
        const avatarB64 = buf.toString("base64");
        charData._avatarDataUrl = `data:image/png;base64,${avatarB64}`;

        return importSTCharacter(charData, app.db);
      }

      // Non-PNG file upload — try parsing as JSON
      try {
        const json = JSON.parse(buf.toString("utf-8"));
        return importSTCharacter(json, app.db);
      } catch {
        return {
          success: false,
          error: "Invalid file format. Expected a JSON character card or a PNG with embedded character data.",
        };
      }
    }

    // Standard JSON body
    return importSTCharacter(req.body as Record<string, unknown>, app.db);
  });

  /** Import a SillyTavern prompt preset (JSON body). */
  app.post("/st-preset", async (req) => {
    return importSTPreset(req.body as Record<string, unknown>, app.db);
  });

  /** Import a SillyTavern World Info / lorebook (JSON body). */
  app.post("/st-lorebook", async (req) => {
    const body = req.body as Record<string, unknown>;
    const fallbackName = typeof body.__filename === "string" ? body.__filename : undefined;
    return importSTLorebook(body, app.db, fallbackName ? { fallbackName } : undefined);
  });

  // ═══════════════════════════════════════════════
  // Bulk Import: Scan + Run from a local ST folder
  // ═══════════════════════════════════════════════

  /** Scan a SillyTavern installation folder, return counts of importable data. */
  app.post("/st-bulk/scan", async (req) => {
    const { folderPath } = req.body as { folderPath: string };
    if (!folderPath || typeof folderPath !== "string") {
      return { success: false, error: "folderPath is required" };
    }
    return scanSTFolder(folderPath.trim());
  });

  /** Run a bulk import from a SillyTavern installation folder (SSE stream with progress). */
  app.post("/st-bulk/run", async (req, reply) => {
    const { folderPath, options } = req.body as {
      folderPath: string;
      options: STBulkImportOptions;
    };
    if (!folderPath || typeof folderPath !== "string") {
      return reply.send({ success: false, error: "folderPath is required" });
    }

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
      const result = await runSTBulkImport(folderPath.trim(), options, app.db, (progress) => {
        sendEvent("progress", progress);
      });
      sendEvent("done", result);
    } catch (err) {
      sendEvent("done", { success: false, error: (err as Error).message, imported: {}, errors: [] });
    }
    reply.raw.end();
  });

  /** Open a native OS folder picker dialog and return the selected path. */
  app.post("/pick-folder", async () => {
    const selected = await pickFolder();
    if (!selected) return { success: false, error: "No folder selected" };
    return { success: true, path: selected };
  });
}
