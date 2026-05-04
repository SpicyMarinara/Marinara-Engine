// ──────────────────────────────────────────────
// Routes: Avatar file serving
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { DATA_DIR } from "../utils/data-dir.js";
import { assertInsideDir, isAllowedImageBuffer } from "../utils/security.js";

const AVATAR_DIR = join(DATA_DIR, "avatars");
const NPC_AVATAR_DIR = join(AVATAR_DIR, "npc");

function ensureDir() {
  if (!existsSync(AVATAR_DIR)) {
    mkdirSync(AVATAR_DIR, { recursive: true });
  }
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function isValidFilename(name: string): boolean {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

export async function avatarsRoutes(app: FastifyInstance) {
  /** Serve an avatar image file. */
  app.get("/file/:filename", async (req, reply) => {
    ensureDir();
    const { filename } = req.params as { filename: string };

    if (!isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filePath = assertInsideDir(AVATAR_DIR, join(AVATAR_DIR, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(stream);
  });

  /** Serve an NPC avatar image by chatId and filename. */
  app.get("/npc/:chatId/:filename", async (req, reply) => {
    const { chatId, filename } = req.params as { chatId: string; filename: string };

    if (!isValidFilename(chatId) || !isValidFilename(filename)) {
      return reply.status(400).send({ error: "Invalid path" });
    }

    const filePath = assertInsideDir(NPC_AVATAR_DIR, join(NPC_AVATAR_DIR, chatId, filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = extname(filename).toLowerCase();
    const { createReadStream } = await import("fs");
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Type", MIME_MAP[ext] ?? "application/octet-stream")
      .header("Cache-Control", "public, max-age=604800")
      .send(stream);
  });

  /** Upload an NPC avatar (base64 data URL). */
  app.post("/npc/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const { name, avatar } = req.body as { name: string; avatar: string };

    if (!isValidFilename(chatId)) {
      return reply.status(400).send({ error: "Invalid chatId" });
    }
    if (!name || !avatar) {
      return reply.status(400).send({ error: "Missing name or avatar" });
    }

    // Extract base64 data from data URL
    const match = avatar.match(/^data:image\/\w+;base64,(.+)$/);
    if (!match) {
      return reply.status(400).send({ error: "Invalid avatar format — expected base64 data URL" });
    }

    const safeName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (!safeName) {
      return reply.status(400).send({ error: "Invalid character name" });
    }

    const npcDir = join(NPC_AVATAR_DIR, chatId);
    if (!existsSync(npcDir)) mkdirSync(npcDir, { recursive: true });

    const imageBuffer = Buffer.from(match[1]!, "base64");
    if (!isAllowedImageBuffer(imageBuffer, ".png")) {
      return reply.status(400).send({ error: "Unsupported or invalid avatar image" });
    }
    const filePath = assertInsideDir(npcDir, join(npcDir, `${safeName}.png`));
    writeFileSync(filePath, imageBuffer);

    return reply.send({ avatarPath: `/api/avatars/npc/${chatId}/${safeName}.png?v=${Date.now()}` });
  });
}
