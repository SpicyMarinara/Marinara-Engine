// ──────────────────────────────────────────────
// LLM Provider — Registry & Factory
// ──────────────────────────────────────────────
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { GoogleProvider } from "./providers/google.provider.js";
import type { BaseLLMProvider } from "./base-provider.js";

/**
 * Factory that creates the correct LLM provider for a given provider type.
 */
export function createLLMProvider(provider: string, baseUrl: string, apiKey: string): BaseLLMProvider {
  switch (provider) {
    case "openai":
    case "openrouter":
    case "nanogpt":
    case "mistral":
    case "cohere":
    case "custom":
      return new OpenAIProvider(baseUrl, apiKey);
    case "anthropic":
      return new AnthropicProvider(baseUrl, apiKey);
    case "google":
      return new GoogleProvider(baseUrl, apiKey);
    default:
      return new OpenAIProvider(baseUrl, apiKey);
  }
}
