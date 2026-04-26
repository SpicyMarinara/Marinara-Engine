// ──────────────────────────────────────────────
// Connection Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const apiProviderSchema = z.enum([
  "openai",
  "anthropic",
  "claude_subscription",
  "google",
  "mistral",
  "cohere",
  "openrouter",
  "nanogpt",
  "custom",
  "image_generation",
]);

export const createConnectionSchema = z.object({
  name: z.string().min(1).max(200),
  provider: apiProviderSchema,
  baseUrl: z.string().url().or(z.literal("")).default(""),
  apiKey: z.string().default(""),
  model: z.string().default(""),
  maxContext: z.number().int().min(1).default(128000),
  isDefault: z.boolean().default(false),
  useForRandom: z.boolean().default(false),
  defaultForAgents: z.boolean().default(false),
  enableCaching: z.boolean().default(false),
  embeddingModel: z.string().default(""),
  embeddingBaseUrl: z.string().url().or(z.literal("")).default(""),
  embeddingConnectionId: z.string().nullable().default(null),
  openrouterProvider: z.string().nullable().default(null),
  imageGenerationSource: z.string().nullable().default(null),
  comfyuiWorkflow: z.string().nullable().default(null),
  imageService: z.string().nullable().default(null),
  maxTokensOverride: z.number().int().min(1).nullable().default(null),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
