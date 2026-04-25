// ──────────────────────────────────────────────
// Lorebook Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const lorebookCategorySchema = z.enum(["world", "character", "npc", "spellbook", "uncategorized"]);

export const selectiveLogicSchema = z.enum(["and", "or", "not"]);

export const activationConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "gt", "lt"]),
  value: z.string(),
});

export const lorebookScheduleSchema = z.object({
  activeTimes: z.array(z.string()).default([]),
  activeDates: z.array(z.string()).default([]),
  activeLocations: z.array(z.string()).default([]),
});

export const createLorebookSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().default(""),
  category: lorebookCategorySchema.default("uncategorized"),
  scanDepth: z.number().int().min(0).default(2),
  tokenBudget: z.number().int().min(0).default(2048),
  recursiveScanning: z.boolean().default(false),
  maxRecursionDepth: z.number().int().min(1).max(10).default(3),
  characterId: z.string().nullable().default(null),
  chatId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  generatedBy: z.enum(["user", "agent", "import", "lorebook-maker"]).nullable().default(null),
  sourceAgentId: z.string().nullable().default(null),
});

export const updateLorebookSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  category: lorebookCategorySchema.optional(),
  scanDepth: z.number().int().min(0).optional(),
  tokenBudget: z.number().int().min(0).optional(),
  recursiveScanning: z.boolean().optional(),
  maxRecursionDepth: z.number().int().min(1).max(10).optional(),
  characterId: z.string().nullable().optional(),
  chatId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  generatedBy: z.enum(["user", "agent", "import", "lorebook-maker"]).nullable().optional(),
  sourceAgentId: z.string().nullable().optional(),
});

export const createLorebookEntrySchema = z.object({
  lorebookId: z.string(),
  name: z.string().min(1).max(200),
  content: z.string().default(""),
  description: z.string().default(""),
  keys: z.array(z.string()).default([]),
  secondaryKeys: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  constant: z.boolean().default(false),
  selective: z.boolean().default(false),
  selectiveLogic: selectiveLogicSchema.default("and"),
  probability: z.number().nullable().default(null),
  scanDepth: z.number().nullable().default(null),
  matchWholeWords: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  useRegex: z.boolean().default(false),
  position: z.number().int().min(0).max(2).default(0),
  depth: z.number().int().min(0).default(4),
  order: z.number().int().default(100),
  role: z.enum(["system", "user", "assistant"]).default("system"),
  sticky: z.number().nullable().default(null),
  cooldown: z.number().nullable().default(null),
  delay: z.number().nullable().default(null),
  ephemeral: z.number().int().min(0).nullable().default(null),
  group: z.string().default(""),
  groupWeight: z.number().nullable().default(null),
  preventRecursion: z.boolean().default(false),
  locked: z.boolean().default(false),
  tag: z.string().default(""),
  relationships: z.record(z.string()).default({}),
  dynamicState: z.record(z.unknown()).default({}),
  activationConditions: z.array(activationConditionSchema).default([]),
  schedule: lorebookScheduleSchema.nullable().default(null),
});

export const updateLorebookEntrySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  keys: z.array(z.string()).optional(),
  secondaryKeys: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  constant: z.boolean().optional(),
  selective: z.boolean().optional(),
  selectiveLogic: selectiveLogicSchema.optional(),
  probability: z.number().nullable().optional(),
  scanDepth: z.number().nullable().optional(),
  matchWholeWords: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  useRegex: z.boolean().optional(),
  position: z.number().int().min(0).max(2).optional(),
  depth: z.number().int().min(0).optional(),
  order: z.number().int().optional(),
  role: z.enum(["system", "user", "assistant"]).optional(),
  sticky: z.number().nullable().optional(),
  cooldown: z.number().nullable().optional(),
  delay: z.number().nullable().optional(),
  ephemeral: z.number().int().min(0).nullable().optional(),
  group: z.string().optional(),
  groupWeight: z.number().nullable().optional(),
  preventRecursion: z.boolean().optional(),
  locked: z.boolean().optional(),
  tag: z.string().optional(),
  relationships: z.record(z.string()).optional(),
  dynamicState: z.record(z.unknown()).optional(),
  activationConditions: z.array(activationConditionSchema).optional(),
  schedule: lorebookScheduleSchema.nullable().optional(),
});

export type CreateLorebookInput = z.input<typeof createLorebookSchema>;
export type UpdateLorebookInput = z.infer<typeof updateLorebookSchema>;
export type CreateLorebookEntryInput = z.input<typeof createLorebookEntrySchema>;
export type UpdateLorebookEntryInput = z.infer<typeof updateLorebookEntrySchema>;
