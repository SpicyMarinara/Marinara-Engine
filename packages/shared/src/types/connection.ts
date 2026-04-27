// ──────────────────────────────────────────────
// API Connection Types
// ──────────────────────────────────────────────

/** Supported API providers. */
export type APIProvider =
  | "openai"
  | "anthropic"
  | "claude_subscription"
  | "google"
  | "mistral"
  | "cohere"
  | "openrouter"
  | "nanogpt"
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
  /** Whether this connection is the default for all agents */
  defaultForAgents: boolean;
  /** Model to use for embedding generation (e.g. "text-embedding-3-small") */
  embeddingModel: string | null;
  /** Separate base URL for the embedding backend (e.g. a second llama.cpp on a different port) */
  embeddingBaseUrl: string | null;
  /** Preferred provider when using OpenRouter (e.g. "anthropic", "google") */
  openrouterProvider: string | null;
  /** Explicit image backend selection for image-generation connections (e.g. ComfyUI on a remote host). */
  imageGenerationSource: string | null;
  /** ComfyUI workflow JSON for image generation */
  comfyuiWorkflow: string | null;
  /** Explicitly selected image generation service ID (e.g. "comfyui", "automatic1111"). Overrides URL inference when set. */
  imageService: string | null;
  /** Default generation parameters for new chats using this connection (JSON) */
  defaultParameters: string | null;
  /** Hard cap on max_tokens for the API response (for providers with lower limits, e.g. DeepSeek at 8192). */
  maxTokensOverride: number | null;
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
