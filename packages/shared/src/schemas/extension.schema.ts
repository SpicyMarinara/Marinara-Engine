// ──────────────────────────────────────────────
// Extension Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const createExtensionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  css: z.string().nullable().optional(),
  js: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  installedAt: z.string().datetime().optional(),
});

export const updateExtensionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    css: z.string().nullable().optional(),
    js: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Must update at least one field",
  });

export type CreateExtensionInput = z.infer<typeof createExtensionSchema>;
export type UpdateExtensionInput = z.infer<typeof updateExtensionSchema>;
