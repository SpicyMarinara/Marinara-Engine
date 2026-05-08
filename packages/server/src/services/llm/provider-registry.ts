// ──────────────────────────────────────────────
// LLM Provider — Registry & Factory
// ──────────────────────────────────────────────
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { ClaudeSubscriptionProvider } from "./providers/claude-subscription.provider.js";
import { GoogleProvider } from "./providers/google.provider.js";
import type { BaseLLMProvider } from "./base-provider.js";

function normalizeCohereOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const lower = trimmed.toLowerCase();

  if (lower.includes("/compatibility/v1")) return trimmed;
  if (lower === "https://api.cohere.com/v2" || lower === "https://api.cohere.ai/v2") {
    return "https://api.cohere.ai/compatibility/v1";
  }

  return trimmed;
}

/**
 * Factory that creates the correct LLM provider for a given provider type.
 */
export function createLLMProvider(
  provider: string,
  baseUrl: string,
  apiKey: string,
  maxContext?: number | null,
  openrouterProvider?: string | null,
  maxTokensOverride?: number | null,
  /** Claude (Subscription) only. When true, asks the Agent SDK to use fast-mode routing. */
  claudeFastMode?: boolean,
): BaseLLMProvider {
  const normalizedMaxContext =
    typeof maxContext === "number" && Number.isFinite(maxContext) && maxContext > 0
      ? Math.floor(maxContext)
      : undefined;
  const normalizedMaxTokensOverride =
    typeof maxTokensOverride === "number" && Number.isFinite(maxTokensOverride) && maxTokensOverride > 0
      ? Math.floor(maxTokensOverride)
      : undefined;

  switch (provider) {
    case "openai":
    case "openrouter":
    case "nanogpt":
    case "xai":
    case "mistral":
    case "custom":
      return new OpenAIProvider(
        baseUrl,
        apiKey,
        normalizedMaxContext,
        openrouterProvider,
        normalizedMaxTokensOverride,
        provider,
      );
    case "cohere":
      return new OpenAIProvider(
        normalizeCohereOpenAIBaseUrl(baseUrl),
        apiKey,
        normalizedMaxContext,
        openrouterProvider,
        normalizedMaxTokensOverride,
        "cohere",
      );
    case "anthropic":
      return new AnthropicProvider(
        baseUrl,
        apiKey,
        normalizedMaxContext,
        openrouterProvider,
        normalizedMaxTokensOverride,
      );
    case "claude_subscription":
      return new ClaudeSubscriptionProvider(
        baseUrl,
        apiKey,
        normalizedMaxContext,
        openrouterProvider,
        normalizedMaxTokensOverride,
        claudeFastMode ?? false,
      );
    case "google":
      return new GoogleProvider(baseUrl, apiKey, normalizedMaxContext, openrouterProvider, normalizedMaxTokensOverride);
    default:
      return new OpenAIProvider(
        baseUrl,
        apiKey,
        normalizedMaxContext,
        openrouterProvider,
        normalizedMaxTokensOverride,
        "custom",
      );
  }
}
