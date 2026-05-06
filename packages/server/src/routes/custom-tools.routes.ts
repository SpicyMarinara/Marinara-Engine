// ──────────────────────────────────────────────
// Routes: Custom Tools
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createCustomToolSchema, updateCustomToolSchema } from "@marinara-engine/shared";
import { createCustomToolsStorage } from "../services/storage/custom-tools.storage.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { isCustomToolScriptEnabled } from "../config/runtime-config.js";

const SCRIPT_TOOL_DISABLED_MESSAGE =
  "Script custom tools are disabled. Set CUSTOM_TOOL_SCRIPT_ENABLED=true in your .env and restart Marinara to enable local script tools.";

export async function customToolsRoutes(app: FastifyInstance) {
  const storage = createCustomToolsStorage(app.db);

  app.get("/", async () => {
    return storage.list();
  });

  app.get("/capabilities", async () => {
    return { scriptExecutionEnabled: isCustomToolScriptEnabled() };
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const tool = await storage.getById(req.params.id);
    if (!tool) return reply.status(404).send({ error: "Tool not found" });
    return tool;
  });

  app.post("/", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Custom tool creation" })) return;
    const input = createCustomToolSchema.parse(req.body);
    if (input.executionType === "script" && !isCustomToolScriptEnabled()) {
      return reply.status(403).send({ error: SCRIPT_TOOL_DISABLED_MESSAGE });
    }
    // Check name uniqueness
    const existing = await storage.getByName(input.name);
    if (existing) {
      return reply.status(409).send({ error: `A tool named "${input.name}" already exists.` });
    }
    return storage.create(input);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Custom tool update" })) return;
    const data = updateCustomToolSchema.parse(req.body);
    const current = await storage.getById(req.params.id);
    if (!current) return reply.status(404).send({ error: "Tool not found" });

    const nextExecutionType = data.executionType ?? current.executionType;
    if (nextExecutionType === "script" && !isCustomToolScriptEnabled()) {
      return reply.status(403).send({ error: SCRIPT_TOOL_DISABLED_MESSAGE });
    }

    return storage.update(req.params.id, data);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Custom tool deletion" })) return;
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });
}
