// ──────────────────────────────────────────────
// Routes: Translation — multi-provider message translation
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { PROVIDERS } from "@marinara-engine/shared";
import { isDeeplxLocalUrlsEnabled } from "../config/runtime-config.js";
import { safeFetch, validateOutboundUrl } from "../utils/security.js";

const GOOGLE_MAX_LENGTH = 5000;

const translateSchema = z.object({
  text: z.string().min(1).max(50000),
  provider: z.enum(["ai", "deeplx", "deepl", "google"]),
  targetLanguage: z.string().min(1),
  connectionId: z.string().optional(),
  deeplApiKey: z.string().optional(),
  deeplxUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "DeepLX URL must use http or https",
    })
    .optional(),
});

export async function translateRoutes(app: FastifyInstance) {
  const connections = createConnectionsStorage(app.db);

  /**
   * POST /api/translate
   * Translates text using the specified provider.
   */
  app.post("/", async (req, reply) => {
    const input = translateSchema.parse(req.body);

    switch (input.provider) {
      case "ai":
        return await translateWithAI(input, connections);
      case "deeplx":
        return await translateWithDeepLX(input);
      case "deepl":
        return await translateWithDeepL(input);
      case "google":
        return await translateWithGoogle(input);
      default:
        return reply.status(400).send({ error: "Unknown translation provider" });
    }
  });
}

// ── AI Translation (via configured LLM connection) ──
async function translateWithAI(
  input: z.infer<typeof translateSchema>,
  connections: ReturnType<typeof createConnectionsStorage>,
) {
  if (!input.connectionId) {
    throw Object.assign(new Error("Connection ID is required for AI translation"), { statusCode: 400 });
  }

  const conn = await connections.getWithKey(input.connectionId);
  if (!conn) {
    throw Object.assign(new Error("API connection not found"), { statusCode: 400 });
  }

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  // Claude (Subscription) uses the local Claude Agent SDK; no HTTP endpoint.
  if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
  if (!baseUrl) {
    throw Object.assign(new Error("No base URL configured for this connection"), { statusCode: 400 });
  }

  const provider = createLLMProvider(
    conn.provider,
    baseUrl,
    conn.apiKey,
    conn.maxContext,
    conn.openrouterProvider,
    conn.maxTokensOverride,
  );
  const result = await provider.chatComplete(
    [
      {
        role: "system",
        content:
          "You are a translator. Translate the given text accurately, preserving formatting, markdown, and any special characters like *asterisks* for actions. Output ONLY the translated text, nothing else — no explanations, no extra commentary.",
      },
      {
        role: "user",
        content: `Translate the following text to ${input.targetLanguage}:\n\n${input.text}`,
      },
    ],
    { model: conn.model, temperature: 0.3 },
  );

  return { translatedText: (result.content ?? "").trim() };
}

// ── DeepLX Translation (self-hosted endpoint) ──
async function translateWithDeepLX(input: z.infer<typeof translateSchema>) {
  if (!input.deeplxUrl) {
    throw Object.assign(new Error("DeepLX URL is required"), { statusCode: 400 });
  }

  let url: URL;
  try {
    url = new URL("/translate", input.deeplxUrl);
  } catch {
    throw Object.assign(new Error("Invalid DeepLX URL"), { statusCode: 400 });
  }

  await validateOutboundUrl(url, {
    allowLocal: isDeeplxLocalUrlsEnabled(),
    allowedProtocols: ["https:", "http:"],
  }).catch((err) => {
    throw Object.assign(new Error(err instanceof Error ? err.message : "DeepLX URL is not allowed"), {
      statusCode: 400,
    });
  });

  const response = await safeFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      source_lang: "auto",
      target_lang: input.targetLanguage.toUpperCase(),
    }),
    signal: AbortSignal.timeout(15_000),
    policy: { allowLocal: isDeeplxLocalUrlsEnabled(), allowedProtocols: ["https:", "http:"] },
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError") throw Object.assign(new Error("DeepLX request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`DeepLX returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as { data?: string; alternatives?: string[] };
  const translated = data.data || data.alternatives?.[0] || "";
  return { translatedText: translated };
}

// ── DeepL API Translation (official) ──
async function translateWithDeepL(input: z.infer<typeof translateSchema>) {
  if (!input.deeplApiKey) {
    throw Object.assign(new Error("DeepL API key is required"), { statusCode: 400 });
  }

  const isFree = input.deeplApiKey.endsWith(":fx");
  const apiUrl = isFree ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

  const response = await safeFetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${input.deeplApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [input.text],
      target_lang: input.targetLanguage.toUpperCase(),
    }),
    signal: AbortSignal.timeout(15_000),
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError") throw Object.assign(new Error("DeepL request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`DeepL API returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as { translations?: Array<{ text: string }> };
  return { translatedText: data.translations?.[0]?.text ?? "" };
}

// ── Google Translate (free API) ──
async function translateWithGoogle(input: z.infer<typeof translateSchema>) {
  if (input.text.length > GOOGLE_MAX_LENGTH) {
    throw Object.assign(
      new Error(
        `Text too long for Google Translate (max ${GOOGLE_MAX_LENGTH} characters). Use DeepL or AI provider for longer texts.`,
      ),
      { statusCode: 400 },
    );
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", input.targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", input.text);

  const response = await safeFetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError")
      throw Object.assign(new Error("Google Translate request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Translate returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as unknown;

  // Google returns nested arrays: [[["translated text", "original text", ...], ...], ...]
  let translated = "";
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const segment of data[0]) {
      if (Array.isArray(segment) && segment[0]) {
        translated += segment[0];
      }
    }
  }

  return { translatedText: translated };
}
