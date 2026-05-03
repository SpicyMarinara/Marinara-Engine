// ──────────────────────────────────────────────
// Routes: Chat Folders
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createChatFoldersStorage } from "../services/storage/chat-folders.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";

export async function chatFoldersRoutes(app: FastifyInstance) {
  const storage = createChatFoldersStorage(app.db);
  const chatsStorage = createChatsStorage(app.db);

  // ── List all folders ──
  app.get("/", async (_req, reply) => {
    const folders = await storage.list();
    // Normalise collapsed from "true"/"false" string to boolean
    return reply.send(
      folders.map((f) => ({
        ...f,
        collapsed: f.collapsed === "true",
      })),
    );
  });

  // ── Create a folder ──
  app.post<{
    Body: { name: string; mode: string; color?: string };
  }>("/", async (req, reply) => {
    const { name, mode, color } = req.body;
    if (!name?.trim()) return reply.status(400).send({ error: "Name is required" });
    if (!["conversation", "roleplay", "visual_novel"].includes(mode)) {
      return reply.status(400).send({ error: "Invalid mode" });
    }
    const folder = await storage.create({ name: name.trim(), mode, color });
    return reply.send({ ...folder, collapsed: folder!.collapsed === "true" });
  });

  // ── Update a folder ──
  app.patch<{
    Params: { id: string };
    Body: Partial<{ name: string; color: string; sortOrder: number; collapsed: boolean }>;
  }>("/:id", async (req, reply) => {
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Folder not found" });
    const folder = await storage.update(req.params.id, req.body);
    return reply.send({ ...folder, collapsed: folder!.collapsed === "true" });
  });

  // ── Delete a folder (chats are moved to root) ──
  app.delete<{
    Params: { id: string };
  }>("/:id", async (req, reply) => {
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Folder not found" });
    await storage.remove(req.params.id);
    return reply.send({ ok: true });
  });

  // ── Reorder folders ──
  app.post<{
    Body: { orderedIds: string[] };
  }>("/reorder", async (req, reply) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return reply.status(400).send({ error: "orderedIds must be an array" });
    await storage.reorder(orderedIds);
    return reply.send({ ok: true });
  });

  // ── Move a chat into (or out of) a folder ──
  app.post<{
    Body: { chatId: string; folderId: string | null };
  }>("/move-chat", async (req, reply) => {
    const { chatId, folderId } = req.body;
    if (!chatId) return reply.status(400).send({ error: "chatId is required" });
    // Validate folder exists if non-null
    if (folderId) {
      const folder = await storage.getById(folderId);
      if (!folder) return reply.status(404).send({ error: "Folder not found" });
    }
    // Propagate the folder to every branch in the group so later branch
    // creation/deletion doesn't drop the tree back into Uncategorized.
    const chat = await chatsStorage.setFolderForChat(chatId, folderId);
    return reply.send(chat);
  });

  // ── Reorder chats within a folder (or root) ──
  app.post<{
    Body: { orderedChatIds: string[]; folderId: string | null };
  }>("/reorder-chats", async (req, reply) => {
    const { orderedChatIds, folderId } = req.body;
    if (!Array.isArray(orderedChatIds)) return reply.status(400).send({ error: "orderedChatIds must be an array" });
    for (let i = 0; i < orderedChatIds.length; i++) {
      const id = orderedChatIds[i]!;
      // Update sortOrder on the visible representative chat, then propagate
      // the folder assignment to its sibling branches.
      await chatsStorage.update(id, { sortOrder: i + 1 });
      await chatsStorage.setFolderForChat(id, folderId);
    }
    return reply.send({ ok: true });
  });
}
