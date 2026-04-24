// ──────────────────────────────────────────────
// Gallery Recovery — re-create DB records for orphaned image files
// ──────────────────────────────────────────────
// Scans data/gallery/ on startup. For every image file on disk that
// has no matching chat_images row (but whose parent chat still exists),
// a new DB record is inserted so the gallery UI shows the image again.
import { existsSync, readdirSync, statSync } from "fs";
import { logger } from "../../lib/logger.js";
import { join, extname } from "path";
import { eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { chatImages, chats } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { DATA_DIR } from "../../utils/data-dir.js";

const GALLERY_DIR = join(DATA_DIR, "gallery");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

export async function recoverGalleryImages(db: DB) {
  if (!existsSync(GALLERY_DIR)) return;

  const chatDirs = readdirSync(GALLERY_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  let recovered = 0;

  for (const dir of chatDirs) {
    try {
      const chatId = dir.name;

      // Only recover for chats that still exist
      const chatRow = await db.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).limit(1);
      if (chatRow.length === 0) continue;

      // Get existing DB records for this chat
      const existingRecords = await db
        .select({ filePath: chatImages.filePath })
        .from(chatImages)
        .where(eq(chatImages.chatId, chatId));
      const knownPaths = new Set(existingRecords.map((r) => r.filePath));

      // Scan image files on disk
      const chatGalleryDir = join(GALLERY_DIR, chatId);
      const files = readdirSync(chatGalleryDir).filter((f) => {
        const ext = extname(f).toLowerCase();
        return IMAGE_EXTS.has(ext) && statSync(join(chatGalleryDir, f)).isFile();
      });

      for (const file of files) {
        const relativePath = `${chatId}/${file}`;
        if (knownPaths.has(relativePath)) continue;

        // Orphaned file — recreate DB record
        await db.insert(chatImages).values({
          id: newId(),
          chatId,
          filePath: relativePath,
          prompt: "",
          provider: "",
          model: "",
          width: null,
          height: null,
          createdAt: now(),
        });
        recovered++;
      }
    } catch (err) {
      logger.warn("[gallery-recovery] Failed to process directory %s: %s", dir.name, err);
    }
  }

  if (recovered > 0) {
    logger.info("[gallery-recovery] Recovered %d orphaned gallery image(s)", recovered);
  }
}
