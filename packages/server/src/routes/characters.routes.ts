// ──────────────────────────────────────────────
// Routes: Characters, Personas & Groups
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import {
  createCharacterSchema,
  updateCharacterSchema,
  createGroupSchema,
  updateGroupSchema,
  createPersonaGroupSchema,
  updatePersonaGroupSchema,
  PROFESSOR_MARI_ID,
} from "@marinara-engine/shared";
import type { ExportEnvelope } from "@marinara-engine/shared";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createCharacterGalleryStorage } from "../services/storage/character-gallery.storage.js";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { DATA_DIR } from "../utils/data-dir.js";
import { createWriteStream, existsSync, rmSync, unlinkSync } from "fs";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";
import { assertInsideDir, extensionFromImageMime, isAllowedImageBuffer } from "../utils/security.js";
import { importSTLorebook } from "../services/import/st-lorebook.importer.js";
import AdmZip from "adm-zip";
import { extname } from "path";
import { pipeline } from "stream/promises";
import { newId } from "../utils/id-generator.js";

const CHARACTER_GALLERY_ROOT = join(DATA_DIR, "gallery", "characters");
const ALLOWED_GALLERY_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const CHARACTER_CARD_PNG_KEYWORDS = new Set(["chara", "ccv3"]);

async function ensureCharacterGalleryDir(characterId: string) {
  const dir = join(CHARACTER_GALLERY_ROOT, characterId);
  await mkdir(dir, { recursive: true });
  return dir;
}

function toSafeExportName(name: string, fallback: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

type ExportFormat = "native" | "compatible";

function buildNativeCharacterEnvelope(
  char: { createdAt: string; updatedAt: string; comment?: string | null },
  data: any,
) {
  return {
    type: "marinara_character",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data,
      metadata: {
        createdAt: char.createdAt,
        updatedAt: char.updatedAt,
        comment: char.comment ?? "",
      },
    },
  } satisfies ExportEnvelope;
}

function buildCompatibleCharacterExport(data: any) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data,
  };
}

function buildNativePersonaEnvelope(persona: Record<string, unknown>) {
  const { id: _id, createdAt, updatedAt, avatarPath: _avatarPath, isActive: _isActive, ...personaData } = persona;
  return {
    type: "marinara_persona",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      ...personaData,
      metadata: {
        createdAt,
        updatedAt,
      },
    },
  } satisfies ExportEnvelope;
}

function buildCompatiblePersonaExport(persona: Record<string, unknown>) {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    avatarPath: _avatarPath,
    isActive: _isActive,
    ...personaData
  } = persona;
  return {
    ...personaData,
    extensions: {
      marinara: {
        exportedAt: new Date().toISOString(),
        source: "Marinara Engine compatibility export",
      },
    },
  };
}

export async function charactersRoutes(app: FastifyInstance) {
  const storage = createCharactersStorage(app.db);
  const characterGallery = createCharacterGalleryStorage(app.db);

  // ── Characters ──

  app.get("/", async () => {
    return storage.list();
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });
    return char;
  });

  app.get<{ Params: { id: string } }>("/:id/versions", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });
    return storage.listVersions(req.params.id);
  });

  app.post<{ Params: { id: string; versionId: string } }>("/:id/versions/:versionId/restore", async (req, reply) => {
    const restored = await storage.restoreVersion(req.params.id, req.params.versionId);
    if (!restored) return reply.status(404).send({ error: "Character version not found" });
    return restored;
  });

  app.delete<{ Params: { id: string; versionId: string } }>("/:id/versions/:versionId", async (req, reply) => {
    const deleted = await storage.deleteVersion(req.params.id, req.params.versionId);
    if (!deleted) return reply.status(404).send({ error: "Character version not found" });
    return reply.status(204).send();
  });

  app.post("/", async (req) => {
    const input = createCharacterSchema.parse(req.body);
    const body = req.body as Record<string, unknown>;
    const avatarPath = typeof body.avatarPath === "string" ? body.avatarPath : undefined;
    const comment = typeof body.comment === "string" ? body.comment : undefined;
    return storage.create(
      input.data,
      avatarPath,
      normalizeTimestampOverrides({
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
      }),
      comment,
    );
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const body = req.body as Record<string, unknown>;
    const update = updateCharacterSchema.parse(req.body);
    const avatarPath = typeof body.avatarPath === "string" ? body.avatarPath : undefined;
    const comment = typeof body.comment === "string" ? body.comment : undefined;
    const versionSource = typeof body.versionSource === "string" ? body.versionSource : undefined;
    const versionReason = typeof body.versionReason === "string" ? body.versionReason : undefined;
    const skipVersionSnapshot = body.skipVersionSnapshot === true;
    return storage.update(req.params.id, update.data ?? {}, avatarPath, {
      comment,
      versionSource,
      versionReason,
      skipVersionSnapshot,
    });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (req.params.id === PROFESSOR_MARI_ID) {
      return reply.status(403).send({ error: "Professor Mari is a built-in character and cannot be deleted" });
    }
    const galleryDir = join(CHARACTER_GALLERY_ROOT, req.params.id);
    if (existsSync(galleryDir)) {
      rmSync(galleryDir, { recursive: true, force: true });
    }
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });

  // ── Character Gallery ──

  app.get<{ Params: { id: string } }>("/:id/gallery", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });

    const images = await characterGallery.listByCharacterId(req.params.id);
    return images.map((img) => ({
      ...img,
      url: `/api/characters/${req.params.id}/gallery/file/${encodeURIComponent(img.filePath.split("/").pop()!)}`,
    }));
  });

  app.post<{ Params: { id: string } }>("/:id/gallery/upload", async (req, reply) => {
    const { id } = req.params;
    const char = await storage.getById(id);
    if (!char) return reply.status(404).send({ error: "Character not found" });

    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = extname(data.filename).toLowerCase();
    if (!ALLOWED_GALLERY_EXTS.has(ext)) {
      return reply.status(400).send({ error: `Unsupported file type: ${ext}` });
    }

    const dir = await ensureCharacterGalleryDir(id);
    const filename = `${newId()}${ext}`;
    const filePath = join(dir, filename);

    await pipeline(data.file, createWriteStream(filePath));

    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const prompt = fields?.prompt?.value ?? "";
    const provider = fields?.provider?.value ?? "";
    const model = fields?.model?.value ?? "";
    const width = fields?.width?.value ? parseInt(fields.width.value, 10) : undefined;
    const height = fields?.height?.value ? parseInt(fields.height.value, 10) : undefined;

    const image = await characterGallery.create({
      characterId: id,
      filePath: `characters/${id}/${filename}`,
      prompt,
      provider,
      model,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    });

    return {
      ...image,
      url: `/api/characters/${id}/gallery/file/${encodeURIComponent(filename)}`,
    };
  });

  app.get<{ Params: { id: string; filename: string } }>("/:id/gallery/file/:filename", async (req, reply) => {
    const { id, filename } = req.params;
    if (filename.includes("..") || filename.includes("/") || id.includes("..") || id.includes("/")) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = join(CHARACTER_GALLERY_ROOT, id, filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    return reply.sendFile(filename, join(CHARACTER_GALLERY_ROOT, id));
  });

  app.delete<{ Params: { id: string; imageId: string } }>("/:id/gallery/:imageId", async (req, reply) => {
    const { id, imageId } = req.params;
    const image = await characterGallery.getById(imageId);
    if (!image || image.characterId !== id) {
      return reply.status(404).send({ error: "Not found" });
    }

    const filePath = join(DATA_DIR, "gallery", image.filePath);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    await characterGallery.remove(imageId);
    return { success: true };
  });

  // ── Duplicate ──
  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const result = await storage.duplicateCharacter(req.params.id);
    if (!result) return reply.status(404).send({ error: "Character not found" });
    return result;
  });

  // ── Export ──

  app.get<{ Params: { id: string }; Querystring: { format?: ExportFormat } }>("/:id/export", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });
    const charData = JSON.parse(char.data);
    const compatible = req.query.format === "compatible";
    const payload = compatible
      ? buildCompatibleCharacterExport(charData)
      : buildNativeCharacterEnvelope(char, charData);
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(charData.name || "character")}.${compatible ? "json" : "marinara.json"}"`,
      )
      .send(payload);
  });

  app.post("/export-bulk", async (req, reply) => {
    const { ids, format = "native" } = req.body as { ids?: string[]; format?: ExportFormat };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids array is required" });
    }

    const zip = new AdmZip();
    let exportedCount = 0;
    for (const id of ids) {
      const char = await storage.getById(id);
      if (!char) continue;
      const charData = JSON.parse(char.data);
      const payload =
        format === "compatible"
          ? buildCompatibleCharacterExport(charData)
          : buildNativeCharacterEnvelope(char, charData);
      zip.addFile(
        `${toSafeExportName(String(charData.name ?? "character"), `character-${exportedCount + 1}`)}.${format === "compatible" ? "json" : "marinara.json"}`,
        Buffer.from(JSON.stringify(payload, null, 2), "utf-8"),
      );
      exportedCount++;
    }

    if (exportedCount === 0) {
      return reply.status(404).send({ error: "No characters found for the provided ids" });
    }

    return reply
      .header("Content-Type", "application/zip")
      .header(
        "Content-Disposition",
        `attachment; filename="${format === "compatible" ? "compatible-characters.zip" : "marinara-characters.zip"}"`,
      )
      .send(zip.toBuffer());
  });

  app.post<{ Params: { id: string } }>("/:id/embedded-lorebook/import", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });

    const charData = JSON.parse(char.data) as Record<string, unknown>;
    const book = charData.character_book as { entries?: unknown[] } | null | undefined;
    const entries = Array.isArray(book?.entries) ? book.entries : [];
    if (entries.length === 0) {
      return reply.status(400).send({ error: "Character does not have an embedded lorebook" });
    }

    const extensions =
      charData.extensions && typeof charData.extensions === "object"
        ? ({ ...(charData.extensions as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const importMetadata =
      extensions.importMetadata && typeof extensions.importMetadata === "object"
        ? ({ ...(extensions.importMetadata as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const embeddedLorebookMetadata =
      importMetadata.embeddedLorebook && typeof importMetadata.embeddedLorebook === "object"
        ? ({ ...(importMetadata.embeddedLorebook as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    const result = await importSTLorebook(
      {
        name: String(charData.name ?? "Character Lorebook"),
        entries: book?.entries ?? [],
        extensions: (book as Record<string, unknown> | null | undefined)?.extensions ?? {},
      },
      app.db,
      {
        characterId: req.params.id,
        namePrefix: String(charData.name ?? "Character"),
        existingLorebookId:
          typeof embeddedLorebookMetadata.lorebookId === "string" ? embeddedLorebookMetadata.lorebookId : null,
      },
    );

    if (!result || "error" in result) {
      return reply.status(500).send({ error: result?.error ?? "Failed to import embedded lorebook" });
    }

    extensions.importMetadata = {
      ...importMetadata,
      embeddedLorebook: {
        ...embeddedLorebookMetadata,
        hasEmbeddedLorebook: true,
        lorebookId: result.lorebookId,
      },
    };

    await storage.update(req.params.id, {
      extensions: extensions as any,
    });

    return {
      success: true,
      lorebookId: result.lorebookId,
      entriesImported: result.entriesImported,
      reimported: result.reimported ?? false,
    };
  });

  // ── Export as PNG ──

  app.get<{ Params: { id: string } }>("/:id/export-png", async (req, reply) => {
    const char = await storage.getById(req.params.id);
    if (!char) return reply.status(404).send({ error: "Character not found" });

    const charData = JSON.parse(char.data);
    const v2Envelope = { spec: "chara_card_v2", spec_version: "2.0", data: charData };
    const charaBase64 = Buffer.from(JSON.stringify(v2Envelope), "utf-8").toString("base64");

    // Read avatar image or create a minimal 1x1 transparent PNG fallback
    let pngBuffer: Buffer;
    if (char.avatarPath) {
      // avatarPath is like /api/avatars/file/abc123.png — extract filename
      const filename = char.avatarPath.split("?")[0]!.split("/").pop()!;
      const avatarFile = join(DATA_DIR, "avatars", filename);
      if (existsSync(avatarFile)) {
        pngBuffer = await readFile(avatarFile);
      } else {
        pngBuffer = createMinimalPng();
      }
    } else {
      pngBuffer = createMinimalPng();
    }

    // Inject "chara" tEXt chunk into the PNG
    const resultPng = injectTextChunk(pngBuffer, "chara", charaBase64);

    const safeName = encodeURIComponent(charData.name || "character");
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Disposition", `attachment; filename="${safeName}.png"`)
      .send(Buffer.from(resultPng));
  });

  // ── Avatar Upload ──

  app.post<{ Params: { id: string } }>("/:id/avatar", async (req, reply) => {
    const { id } = req.params;
    const char = await storage.getById(id);
    if (!char) return reply.status(404).send({ error: "Character not found" });

    const body = req.body as { avatar?: string; filename?: string };
    if (!body.avatar) {
      return reply.status(400).send({ error: "No avatar data provided" });
    }

    // avatar is a base64 data URL or raw base64
    let base64 = body.avatar;
    let ext = "png";
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:image\/([\w+]+);base64,/);
      if (match?.[1]) {
        ext = match[1].replace("+xml", "");
        base64 = base64.slice(base64.indexOf(",") + 1);
      }
    }
    const imageBuffer = Buffer.from(base64, "base64");
    const imageInfo = isAllowedImageBuffer(imageBuffer, `.${ext}`);
    if (!imageInfo) return reply.status(400).send({ error: "Unsupported or invalid avatar image" });
    ext = extensionFromImageMime(imageInfo.mimeType);

    const avatarsDir = join(DATA_DIR, "avatars");
    await mkdir(avatarsDir, { recursive: true });
    const filename = `character-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = assertInsideDir(avatarsDir, join(avatarsDir, filename));
    await writeFile(filepath, imageBuffer);

    const avatarPath = `/api/avatars/file/${filename}`;
    return storage.updateAvatar(id, avatarPath);
  });

  // ── Personas ──

  app.get("/personas/list", async () => {
    return storage.listPersonas();
  });

  app.get<{ Params: { id: string } }>("/personas/:id", async (req, reply) => {
    const persona = await storage.getPersona(req.params.id);
    if (!persona) return reply.status(404).send({ error: "Persona not found" });
    return persona;
  });

  app.post("/personas", async (req) => {
    const { name, description, createdAt, updatedAt, ...extra } = req.body as {
      name: string;
      description?: string;
      personality?: string;
      scenario?: string;
      backstory?: string;
      appearance?: string;
      nameColor?: string;
      dialogueColor?: string;
      boxColor?: string;
      createdAt?: string;
      updatedAt?: string;
      savedStatusOptions?: string;
    };
    return storage.createPersona(
      name,
      description ?? "",
      undefined,
      extra,
      normalizeTimestampOverrides({ createdAt, updatedAt }),
    );
  });

  app.patch<{ Params: { id: string } }>("/personas/:id", async (req) => {
    const body = req.body as Record<string, unknown>;
    return storage.updatePersona(req.params.id, body);
  });

  app.post<{ Params: { id: string } }>("/personas/:id/avatar", async (req, reply) => {
    const body = req.body as { avatar?: string; filename?: string };
    if (!body.avatar) return reply.status(400).send({ error: "No avatar data" });
    let base64 = body.avatar;
    let hintedExt = ".png";
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:image\/([\w+]+);base64,/);
      if (match?.[1]) hintedExt = `.${match[1].replace("+xml", "")}`;
    }
    if (base64.includes(",")) base64 = base64.split(",")[1]!;
    const imageBuffer = Buffer.from(base64, "base64");
    const imageInfo = isAllowedImageBuffer(imageBuffer, hintedExt);
    if (!imageInfo) return reply.status(400).send({ error: "Unsupported or invalid avatar image" });
    const filename = `persona-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imageInfo.ext}`;
    const avatarsDir = join(DATA_DIR, "avatars");
    await mkdir(avatarsDir, { recursive: true });
    const filepath = assertInsideDir(avatarsDir, join(avatarsDir, filename));
    await writeFile(filepath, imageBuffer);
    const avatarPath = `/api/avatars/file/${filename}`;
    return storage.updatePersona(req.params.id, { avatarPath });
  });

  app.put<{ Params: { id: string } }>("/personas/:id/activate", async (req) => {
    await storage.setActivePersona(req.params.id);
    return { success: true };
  });

  app.delete<{ Params: { id: string } }>("/personas/:id", async (req, reply) => {
    await storage.removePersona(req.params.id);
    return reply.status(204).send();
  });

  // ── Persona Duplicate ──
  app.post<{ Params: { id: string } }>("/personas/:id/duplicate", async (req, reply) => {
    const result = await storage.duplicatePersona(req.params.id);
    if (!result) return reply.status(404).send({ error: "Persona not found" });
    return result;
  });

  // ── Persona Export ──

  app.get<{ Params: { id: string }; Querystring: { format?: ExportFormat } }>(
    "/personas/:id/export",
    async (req, reply) => {
      const persona = await storage.getPersona(req.params.id);
      if (!persona) return reply.status(404).send({ error: "Persona not found" });
      const compatible = req.query.format === "compatible";
      const payload = compatible
        ? buildCompatiblePersonaExport(persona as Record<string, unknown>)
        : buildNativePersonaEnvelope(persona as Record<string, unknown>);
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(String(persona.name || "persona"))}.${compatible ? "json" : "marinara.json"}"`,
        )
        .send(payload);
    },
  );

  app.post("/personas/export-bulk", async (req, reply) => {
    const { ids, format = "native" } = req.body as { ids?: string[]; format?: ExportFormat };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids array is required" });
    }

    const zip = new AdmZip();
    let exportedCount = 0;
    for (const id of ids) {
      const persona = await storage.getPersona(id);
      if (!persona) continue;
      const payload =
        format === "compatible"
          ? buildCompatiblePersonaExport(persona as Record<string, unknown>)
          : buildNativePersonaEnvelope(persona as Record<string, unknown>);
      zip.addFile(
        `${toSafeExportName(String(persona.name ?? "persona"), `persona-${exportedCount + 1}`)}.${format === "compatible" ? "json" : "marinara.json"}`,
        Buffer.from(JSON.stringify(payload, null, 2), "utf-8"),
      );
      exportedCount++;
    }

    if (exportedCount === 0) {
      return reply.status(404).send({ error: "No personas found for the provided ids" });
    }

    return reply
      .header("Content-Type", "application/zip")
      .header(
        "Content-Disposition",
        `attachment; filename="${format === "compatible" ? "compatible-personas.zip" : "marinara-personas.zip"}"`,
      )
      .send(zip.toBuffer());
  });

  // ── Character Groups ──

  app.get("/groups/list", async () => {
    return storage.listGroups();
  });

  app.get<{ Params: { id: string } }>("/groups/:id", async (req, reply) => {
    const group = await storage.getGroupById(req.params.id);
    if (!group) return reply.status(404).send({ error: "Group not found" });
    return group;
  });

  app.post("/groups", async (req) => {
    const input = createGroupSchema.parse(req.body);
    return storage.createGroup(input.name, input.description ?? "", input.characterIds ?? []);
  });

  app.patch<{ Params: { id: string } }>("/groups/:id", async (req) => {
    const input = updateGroupSchema.parse(req.body);
    return storage.updateGroup(req.params.id, input);
  });

  app.delete<{ Params: { id: string } }>("/groups/:id", async (req, reply) => {
    await storage.removeGroup(req.params.id);
    return reply.status(204).send();
  });

  // ── Persona Groups ──

  app.get("/persona-groups/list", async () => {
    return storage.listPersonaGroups();
  });

  app.get<{ Params: { id: string } }>("/persona-groups/:id", async (req, reply) => {
    const group = await storage.getPersonaGroupById(req.params.id);
    if (!group) return reply.status(404).send({ error: "Persona group not found" });
    return group;
  });

  app.post("/persona-groups", async (req) => {
    const input = createPersonaGroupSchema.parse(req.body);
    return storage.createPersonaGroup(input.name, input.description ?? "", input.personaIds ?? []);
  });

  app.patch<{ Params: { id: string } }>("/persona-groups/:id", async (req) => {
    const input = updatePersonaGroupSchema.parse(req.body);
    return storage.updatePersonaGroup(req.params.id, input);
  });

  app.delete<{ Params: { id: string } }>("/persona-groups/:id", async (req, reply) => {
    await storage.removePersonaGroup(req.params.id);
    return reply.status(204).send();
  });
}

// ── PNG helpers ──

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Create a minimal 1×1 transparent PNG (for characters without avatars). */
export function createMinimalPng(): Buffer {
  // IHDR chunk data: 1×1, 8-bit RGBA
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  // IDAT: deflate-compressed scanline (filter byte 0 + 4 zero bytes for transparent pixel)
  // Pre-computed deflate of [0, 0, 0, 0, 0]
  const idatData = Buffer.from([0x78, 0x01, 0x62, 0x60, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01]);

  const chunks: Buffer[] = [
    PNG_SIGNATURE,
    buildChunk("IHDR", ihdrData),
    buildChunk("IDAT", idatData),
    buildChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

/** Build a single PNG chunk (length + type + data + CRC). */
function buildChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function readPngTextKeyword(chunkType: string, chunkData: Buffer): string | null {
  if (chunkType !== "tEXt" && chunkType !== "iTXt") return null;

  const nullIdx = chunkData.indexOf(0);
  if (nullIdx <= 0) return null;
  return chunkData.subarray(0, nullIdx).toString("latin1");
}

/** Inject a tEXt chunk into an existing PNG buffer, right before the first IDAT. */
export function injectTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  // Validate PNG signature
  if (png.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
    throw new Error("Invalid PNG signature");
  }

  // Build the tEXt chunk: keyword\0text
  const textData = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const textChunk = buildChunk("tEXt", textData);

  // Walk chunks, insert before first IDAT
  const parts: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let inserted = false;

  while (offset < png.length) {
    const chunkLen = png.readUInt32BE(offset);
    const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
    const totalChunkSize = 4 + 4 + chunkLen + 4; // length + type + data + crc
    const chunkBuf = png.subarray(offset, offset + totalChunkSize);
    const chunkData = png.subarray(offset + 8, offset + 8 + chunkLen);
    const embeddedKeyword = readPngTextKeyword(chunkType, chunkData);

    if (embeddedKeyword && CHARACTER_CARD_PNG_KEYWORDS.has(embeddedKeyword)) {
      offset += totalChunkSize;
      continue;
    }

    if (chunkType === "IDAT" && !inserted) {
      parts.push(textChunk);
      inserted = true;
    }
    parts.push(chunkBuf);
    offset += totalChunkSize;
  }

  // If no IDAT found (shouldn't happen), append before end
  if (!inserted) {
    parts.splice(parts.length - 1, 0, textChunk);
  }

  return Buffer.concat(parts);
}

/** CRC-32 as used by PNG (ISO 3309 / ITU-T V.42). */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
