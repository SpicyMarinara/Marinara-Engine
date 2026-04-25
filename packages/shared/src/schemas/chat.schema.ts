// ──────────────────────────────────────────────
// Chat Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const chatModeSchema = z.enum(["conversation", "roleplay", "visual_novel", "game"]);

export const messageRoleSchema = z.enum(["user", "assistant", "system", "narrator"]);

export const createChatSchema = z.object({
  name: z.string().min(1).max(200),
  mode: chatModeSchema,
  characterIds: z.array(z.string()).default([]),
  groupId: z.string().nullable().default(null),
  personaId: z.string().nullable().default(null),
  promptPresetId: z.string().nullable().default(null),
  connectionId: z.string().nullable().default(null),
});

export const createMessageSchema = z.object({
  chatId: z.string(),
  role: messageRoleSchema,
  characterId: z.string().nullable().default(null),
  content: z.string(),
});

export const generateRequestSchema = z.object({
  chatId: z.string(),
  userMessage: z.string().nullable().default(null),
  regenerateMessageId: z.string().nullable().default(null),
  connectionId: z.string().nullable().default(null),

  impersonate: z.boolean().optional().default(false),
  streaming: z.boolean().optional().default(true),
  userStatus: z.enum(["active", "idle", "dnd"]).optional().default("active"),
  mentionedCharacterNames: z.array(z.string()).optional().default([]),
  forCharacterId: z.string().nullable().optional().default(null),
  attachments: z
    .array(
      z.object({
        type: z.string(),
        data: z.string(),
      }),
    )
    .optional()
    .default([]),
});

// Auto-summarization entries — shape-only validation (no length caps).
export const summaryEntrySchema = z.object({
  summary: z.string(),
  keyDetails: z.array(z.string()),
});

export const summariesPatchSchema = z.object({
  daySummaries: z.record(z.string(), summaryEntrySchema).optional(),
  weekSummaries: z.record(z.string(), summaryEntrySchema).optional(),
});

export type CreateChatInput = z.infer<typeof createChatSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;
export type SummariesPatchInput = z.infer<typeof summariesPatchSchema>;
