// ──────────────────────────────────────────────
// Routes: Prompts (Presets, Groups, Sections, Choices)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import {
  createPromptPresetSchema,
  updatePromptPresetSchema,
  createPromptSectionSchema,
  updatePromptSectionSchema,
  createPromptGroupSchema,
  updatePromptGroupSchema,
  createChoiceBlockSchema,
  updateChoiceBlockSchema,
  type LorebookEntryTimingState,
} from "@marinara-engine/shared";
import type { ExportEnvelope } from "@marinara-engine/shared";
import { createPromptsStorage } from "../services/storage/prompts.storage.js";
import { assemblePrompt, type AssemblerInput } from "../services/prompt/index.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";
import AdmZip from "adm-zip";

function toSafeExportName(name: string, fallback: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

export async function promptsRoutes(app: FastifyInstance) {
  const storage = createPromptsStorage(app.db);

  // ═══════════════════════════════════════════
  //  Presets
  // ═══════════════════════════════════════════

  app.get("/", async () => {
    return storage.list();
  });

  app.get("/default", async () => {
    return storage.getDefault();
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const preset = await storage.getById(req.params.id);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });
    return preset;
  });

  /** Get a full preset with all its sections, groups, and choice blocks. */
  app.get<{ Params: { id: string } }>("/:id/full", async (req, reply) => {
    const preset = await storage.getById(req.params.id);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });
    const [sections, groups, choiceBlocks] = await Promise.all([
      storage.listSections(req.params.id),
      storage.listGroups(req.params.id),
      storage.listChoiceBlocksForPreset(req.params.id),
    ]);
    return { preset, sections, groups, choiceBlocks };
  });

  app.post("/", async (req) => {
    const input = createPromptPresetSchema.parse(req.body);
    const body = req.body as Record<string, unknown>;
    return storage.create(
      input,
      normalizeTimestampOverrides({
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
      }),
    );
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const input = updatePromptPresetSchema.parse(req.body);
    return storage.update(req.params.id, input);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const result = await storage.duplicate(req.params.id);
    if (!result) return reply.status(404).send({ error: "Preset not found" });
    return result;
  });

  app.post<{ Params: { id: string } }>("/:id/set-default", async (req, reply) => {
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Preset not found" });
    const updated = await storage.setDefault(req.params.id);
    return updated;
  });

  // ── Export ──

  app.get<{ Params: { id: string } }>("/:id/export", async (req, reply) => {
    const preset = await storage.getById(req.params.id);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });
    const [sections, groups, choiceBlocks] = await Promise.all([
      storage.listSections(req.params.id),
      storage.listGroups(req.params.id),
      storage.listChoiceBlocksForPreset(req.params.id),
    ]);
    const envelope: ExportEnvelope = {
      type: "marinara_preset",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { preset, sections, groups, choiceBlocks },
    };
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(preset.name || "preset")}.marinara.json"`,
      )
      .send(envelope);
  });

  app.post("/export-bulk", async (req, reply) => {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids array is required" });
    }

    const zip = new AdmZip();
    let exportedCount = 0;
    for (const id of ids) {
      const preset = await storage.getById(id);
      if (!preset) continue;
      const [sections, groups, choiceBlocks] = await Promise.all([
        storage.listSections(id),
        storage.listGroups(id),
        storage.listChoiceBlocksForPreset(id),
      ]);
      const envelope: ExportEnvelope = {
        type: "marinara_preset",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: { preset, sections, groups, choiceBlocks },
      };
      zip.addFile(
        `${toSafeExportName(preset.name || "preset", `preset-${exportedCount + 1}`)}.marinara.json`,
        Buffer.from(JSON.stringify(envelope, null, 2), "utf-8"),
      );
      exportedCount++;
    }

    if (exportedCount === 0) {
      return reply.status(404).send({ error: "No presets found for the provided ids" });
    }

    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", 'attachment; filename="marinara-presets.zip"')
      .send(zip.toBuffer());
  });

  // ═══════════════════════════════════════════
  //  Groups
  // ═══════════════════════════════════════════

  app.get<{ Params: { id: string } }>("/:id/groups", async (req) => {
    return storage.listGroups(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/:id/groups", async (req) => {
    const input = createPromptGroupSchema.parse({
      ...(req.body as Record<string, unknown>),
      presetId: req.params.id,
    });
    return storage.createGroup(input);
  });

  app.patch<{ Params: { presetId: string; groupId: string } }>("/:presetId/groups/:groupId", async (req) => {
    const input = updatePromptGroupSchema.parse(req.body);
    return storage.updateGroup(req.params.groupId, input);
  });

  app.delete<{ Params: { presetId: string; groupId: string } }>("/:presetId/groups/:groupId", async (req, reply) => {
    await storage.removeGroup(req.params.groupId);
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>("/:id/groups/reorder", async (req) => {
    const { groupIds } = req.body as { groupIds: string[] };
    await storage.reorderGroups(req.params.id, groupIds);
    return { success: true };
  });

  // ═══════════════════════════════════════════
  //  Sections
  // ═══════════════════════════════════════════

  app.get<{ Params: { id: string } }>("/:id/sections", async (req) => {
    return storage.listSections(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/:id/sections", async (req) => {
    const input = createPromptSectionSchema.parse({
      ...(req.body as Record<string, unknown>),
      presetId: req.params.id,
    });
    return storage.createSection(input);
  });

  app.patch<{ Params: { presetId: string; sectionId: string } }>("/:presetId/sections/:sectionId", async (req) => {
    const input = updatePromptSectionSchema.parse(req.body);
    return storage.updateSection(req.params.sectionId, input);
  });

  app.delete<{ Params: { presetId: string; sectionId: string } }>(
    "/:presetId/sections/:sectionId",
    async (req, reply) => {
      await storage.removeSection(req.params.sectionId);
      return reply.status(204).send();
    },
  );

  app.put<{ Params: { id: string } }>("/:id/sections/reorder", async (req) => {
    const { sectionIds } = req.body as { sectionIds: string[] };
    await storage.reorderSections(req.params.id, sectionIds);
    return { success: true };
  });

  // ═══════════════════════════════════════════
  //  Preset Variables (Choice Blocks)
  // ═══════════════════════════════════════════

  app.get<{ Params: { presetId: string } }>("/:presetId/variables", async (req) => {
    return storage.listChoiceBlocksForPreset(req.params.presetId);
  });

  app.post<{ Params: { presetId: string } }>("/:presetId/variables", async (req) => {
    const input = createChoiceBlockSchema.parse({
      ...(req.body as Record<string, unknown>),
      presetId: req.params.presetId,
    });
    return storage.createChoiceBlock(input);
  });

  app.patch<{ Params: { presetId: string; variableId: string } }>("/:presetId/variables/:variableId", async (req) => {
    const input = updateChoiceBlockSchema.parse(req.body);
    return storage.updateChoiceBlock(req.params.variableId, input);
  });

  app.delete<{ Params: { presetId: string; variableId: string } }>(
    "/:presetId/variables/:variableId",
    async (req, reply) => {
      await storage.removeChoiceBlock(req.params.variableId);
      return reply.status(204).send();
    },
  );

  app.put<{ Params: { presetId: string } }>("/:presetId/variables/reorder", async (req) => {
    const { variableIds } = req.body as { variableIds: string[] };
    await storage.reorderVariables(req.params.presetId, variableIds);
    return { success: true };
  });

  // ═══════════════════════════════════════════
  //  Prompt Preview (Assembled)
  // ═══════════════════════════════════════════

  /**
   * POST /:id/preview — Preview the assembled prompt for a given chat.
   * Body: { chatId: string, choices?: Record<string, string> }
   */
  app.post<{ Params: { id: string } }>("/:id/preview", async (req, reply) => {
    const { chatId, choices } = req.body as { chatId: string; choices?: Record<string, string> };
    const preset = await storage.getById(req.params.id);
    if (!preset) return reply.status(404).send({ error: "Preset not found" });

    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const characterIds: string[] = JSON.parse(chat.characterIds as string);
    const chatMessages = await chats.listMessages(chatId);
    let chatMeta: Record<string, unknown> = {};
    try {
      chatMeta =
        typeof chat.metadata === "string"
          ? JSON.parse(chat.metadata)
          : ((chat.metadata as Record<string, unknown>) ?? {});
    } catch {
      chatMeta = {};
    }
    const mappedMessages = chatMessages.map((m: any) => ({
      role: m.role === "narrator" ? ("system" as const) : (m.role as "user" | "assistant" | "system"),
      content: m.content as string,
    }));

    // Resolve persona
    const charStorage = createCharactersStorage(app.db);
    let personaId: string | null = null;
    let personaName = "User";
    let personaDescription = "";
    let personaFields: { personality?: string; scenario?: string; backstory?: string; appearance?: string } = {};
    // Get active persona
    const allPersonas = await charStorage.listPersonas();
    const activePersona =
      (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
      allPersonas.find((p: any) => p.isActive === "true");
    if (activePersona) {
      personaId = activePersona.id as string;
      personaName = activePersona.name;
      personaDescription = activePersona.description;
      personaFields = {
        personality: activePersona.personality ?? "",
        scenario: activePersona.scenario ?? "",
        backstory: activePersona.backstory ?? "",
        appearance: activePersona.appearance ?? "",
      };
    }

    const [sections, groups, choiceBlocks] = await Promise.all([
      storage.listSections(req.params.id),
      storage.listGroups(req.params.id),
      storage.listChoiceBlocksForPreset(req.params.id),
    ]);

    const assemblerInput: AssemblerInput = {
      db: app.db,
      preset: preset as any,
      sections: sections as any,
      groups: groups as any,
      choiceBlocks: choiceBlocks as any,
      chatChoices: choices ?? {},
      chatId,
      characterIds,
      personaId,
      personaName,
      personaDescription,
      personaFields,
      chatMessages: mappedMessages,
      activeLorebookIds: Array.isArray(chatMeta.activeLorebookIds) ? (chatMeta.activeLorebookIds as string[]) : [],
      chatEmbedding: null,
      entryStateOverrides:
        ((chatMeta.entryStateOverrides ?? chatMeta.lorebookEntryStateOverrides) &&
        typeof (chatMeta.entryStateOverrides ?? chatMeta.lorebookEntryStateOverrides) === "object")
          ? ((chatMeta.entryStateOverrides ?? chatMeta.lorebookEntryStateOverrides) as Record<
              string,
              { ephemeral?: number | null; enabled?: boolean }
            >)
          : undefined,
      entryTimingStates:
        ((chatMeta.entryTimingStates ?? chatMeta.lorebookEntryTimingStates) &&
        typeof (chatMeta.entryTimingStates ?? chatMeta.lorebookEntryTimingStates) === "object")
          ? ((chatMeta.entryTimingStates ?? chatMeta.lorebookEntryTimingStates) as Record<
              string,
              LorebookEntryTimingState
            >)
          : undefined,
      lorebookTokenBudget:
        typeof chatMeta.lorebookTokenBudget === "number" ? chatMeta.lorebookTokenBudget : undefined,
      generationTriggers: Array.isArray(chatMeta.generationTriggers)
        ? (chatMeta.generationTriggers as string[])
        : undefined,
      previewOnly: true,
    };

    const result = await assemblePrompt(assemblerInput);
    return {
      messages: result.messages,
      parameters: result.parameters,
      messageCount: result.messages.length,
    };
  });
}
