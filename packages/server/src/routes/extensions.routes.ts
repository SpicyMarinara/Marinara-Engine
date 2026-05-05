// ──────────────────────────────────────────────
// Routes: Installed Extensions
// ──────────────────────────────────────────────
//
// Extensions are stored server-side so they can be served back at
// /api/extensions/:id/script.js — a same-origin URL that satisfies the
// strict `script-src 'self'` CSP without needing 'unsafe-eval'. The script
// payload is wrapped server-side in an IIFE that pulls the per-extension
// `marinara` API helper out of a window-scoped registry the client
// populated immediately before injecting the <script> tag.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createExtensionSchema, updateExtensionSchema } from "@marinara-engine/shared";
import { createExtensionsStorage } from "../services/storage/extensions.storage.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function escapeJsString(value: string): string {
  // Safe to drop into a JSON.parse-able literal in the wrapper.
  return JSON.stringify(value);
}

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

  // Serve an enabled extension's JS as same-origin executable script.
  // Disabled or missing extensions return 404 so cached <script> tags become
  // inert as soon as the user disables/uninstalls.
  app.get<{ Params: { id: string } }>("/:id/script.js", async (req, reply) => {
    if (!ID_PATTERN.test(req.params.id)) {
      return reply.status(404).send("// Extension not found\n");
    }
    const ext = await storage.getById(req.params.id);
    if (!ext || !ext.enabled || !ext.js) {
      reply.header("Content-Type", "application/javascript; charset=utf-8");
      reply.header("Cache-Control", "no-store");
      return reply.status(404).send("// Extension not found or disabled\n");
    }

    const idLiteral = escapeJsString(ext.id);
    const nameLiteral = escapeJsString(ext.name);

    // Wrap the user's JS in an IIFE that:
    //   1. Pulls the per-extension API helper out of window.__marinaraExt.
    //   2. Bails silently if the loader cleaned up (e.g. extension was
    //      disabled while the <script> was still in flight).
    //   3. Catches and logs runtime errors so one extension can't break
    //      others on the page.
    // The user's JS is appended verbatim — it never goes through eval/Function.
    const wrapped =
      `(function(){\n` +
      `  var __id=${idLiteral};\n` +
      `  var __name=${nameLiteral};\n` +
      `  var marinara=(typeof window!=="undefined"&&window.__marinaraExt&&window.__marinaraExt.get)?window.__marinaraExt.get(__id):null;\n` +
      `  if(!marinara){console.warn("[Extension:"+__name+"] no API bound; loader may have cleaned up before script loaded");return;}\n` +
      `  try{\n` +
      ext.js +
      `\n  }catch(e){console.error("[Extension:"+__name+"] error",e);}\n` +
      `})();\n`;

    reply.header("Content-Type", "application/javascript; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return reply.send(wrapped);
  });
}
