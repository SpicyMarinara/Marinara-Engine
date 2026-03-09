// ──────────────────────────────────────────────
// API Connection Types
// ──────────────────────────────────────────────

/** Supported API providers. */
export type APIProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "cohere"
  | "openrouter"
  | "custom"
  | "image_generation";

/** An API connection configuration. */
export interface APIConnection {
  id: string;
  name: string;
  provider: APIProvider;
  /** Base URL for the API (custom endpoints) */
  baseUrl: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
  model: string;
  /** Maximum context window size for this model */
  maxContext: number;
  /** Whether this connection is the default */
  isDefault: boolean;
  /** Whether this connection is in the random-selection pool */
  useForRandom: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Model information returned from a provider. */
export interface ModelInfo {
  id: string;
  name: string;
  maxContext: number;
  provider: APIProvider;
  capabilities: ModelCapabilities;
}

/** What a model supports. */
export interface ModelCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  reasoning: boolean;
}

/** Test result for a connection. */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  modelName: string | null;
}
