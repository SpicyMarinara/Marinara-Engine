// ──────────────────────────────────────────────
// Routes: API Connection Folders
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createConnectionFoldersStorage } from "../services/storage/connection-folders.storage.js";

export async function connectionFoldersRoutes(app: FastifyInstance) {
  const storage = createConnectionFoldersStorage(app.db);

  // ── List all folders ──
  app.get("/", async (_req, reply) => {
    const folders = await storage.list();
    return reply.send(
      folders.map((f) => ({
        ...f,
        collapsed: f.collapsed === "true",
      })),
    );
  });

  // ── Create a folder ──
  app.post<{
    Body: { name: string; color?: string };
  }>("/", async (req, reply) => {
    const { name, color } = req.body;
    if (!name?.trim()) return reply.status(400).send({ error: "Name is required" });
    const folder = await storage.create({ name: name.trim(), color });
    if (!folder) return reply.status(500).send({ error: "Failed to create folder" });
    return reply.send({ ...folder, collapsed: folder.collapsed === "true" });
  });

  // ── Update a folder ──
  app.patch<{
    Params: { id: string };
    Body: Partial<{ name: string; color: string; sortOrder: number; collapsed: boolean }>;
  }>("/:id", async (req, reply) => {
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Folder not found" });
    const folder = await storage.update(req.params.id, req.body);
    if (!folder) return reply.status(500).send({ error: "Failed to update folder" });
    return reply.send({ ...folder, collapsed: folder.collapsed === "true" });
  });

  // ── Delete a folder (connections are moved to root) ──
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

  // ── Move a connection into (or out of) a folder ──
  app.post<{
    Body: { connectionId: string; folderId: string | null };
  }>("/move-connection", async (req, reply) => {
    const { connectionId, folderId } = req.body;
    if (!connectionId) return reply.status(400).send({ error: "connectionId is required" });
    if (folderId) {
      const folder = await storage.getById(folderId);
      if (!folder) return reply.status(404).send({ error: "Folder not found" });
    }
    await storage.moveConnection(connectionId, folderId);
    return reply.send({ ok: true });
  });

  // ── Reorder connections within a folder (or root) ──
  app.post<{
    Body: { orderedConnectionIds: string[]; folderId: string | null };
  }>("/reorder-connections", async (req, reply) => {
    const { orderedConnectionIds, folderId } = req.body;
    if (!Array.isArray(orderedConnectionIds))
      return reply.status(400).send({ error: "orderedConnectionIds must be an array" });
    await storage.reorderConnections(orderedConnectionIds, folderId);
    return reply.send({ ok: true });
  });
}
