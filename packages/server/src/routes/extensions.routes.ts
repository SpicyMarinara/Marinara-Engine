// ──────────────────────────────────────────────
// Routes: Installed Extensions
// ──────────────────────────────────────────────
//
// CRUD only. Extension JS is fetched as part of the list payload and
// loaded client-side via the existing v1.5.8 blob-URL loader in
// `CustomThemeInjector.tsx` — no server-side script-serving endpoint.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createExtensionSchema, updateExtensionSchema } from "@marinara-engine/shared";
import { createExtensionsStorage } from "../services/storage/extensions.storage.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function extensionsRoutes(app: FastifyInstance) {
  const storage = createExtensionsStorage(app.db);

  app.get("/", async () => {
    return storage.list();
  });

  app.post("/", async (req) => {
    const input = createExtensionSchema.parse(req.body);
    return storage.create(input);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!ID_PATTERN.test(req.params.id)) {
      return reply.status(404).send({ error: "Extension not found" });
    }
    const data = updateExtensionSchema.parse(req.body);
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Extension not found" });
    return storage.update(req.params.id, data);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!ID_PATTERN.test(req.params.id)) {
      return reply.status(404).send({ error: "Extension not found" });
    }
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Extension not found" });
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });
}
