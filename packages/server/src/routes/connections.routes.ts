// ──────────────────────────────────────────────
// Routes: Connections
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { MODEL_LISTS, createConnectionSchema, inferImageSource } from "@marinara-engine/shared";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import { isImageLocalUrlsEnabled, isProviderLocalUrlsEnabled } from "../config/runtime-config.js";
import { normalizeLoopbackUrl, safeFetch } from "../utils/security.js";

function resolveImageGenerationSource(conn: Record<string, unknown>, baseUrl: string): string {
  const explicitSource = typeof conn.imageGenerationSource === "string" ? conn.imageGenerationSource : "";
  const model = typeof conn.model === "string" ? conn.model : "";
  return inferImageSource(explicitSource || model, baseUrl);
}

function localUrlPolicyForProvider(provider: string, imageSource: string) {
  const isLocalImageBackend =
    provider === "image_generation" && (imageSource === "comfyui" || imageSource === "automatic1111");
  const isImage = provider === "image_generation";
  return {
    allowLocal:
      isLocalImageBackend || (isImage && isImageLocalUrlsEnabled()) ? true : isProviderLocalUrlsEnabled(),
    allowLoopback: true,
    allowMdns: provider !== "image_generation" || isLocalImageBackend || isImageLocalUrlsEnabled(),
    allowedProtocols: ["https:", "http:"],
    flagName: isImage ? "IMAGE_LOCAL_URLS_ENABLED" : "PROVIDER_LOCAL_URLS_ENABLED",
  };
}

function normalizeConnectionTestBaseUrl(baseUrl: string, provider: string): string {
  if (provider !== "image_generation") return baseUrl;
  try {
    return normalizeLoopbackUrl(baseUrl).replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

function buildStabilityUrl(baseUrl: string, targetPath: string): string {
  try {
    const url = new URL(baseUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const versionIndex = parts.findIndex((part) => part === "v1" || part === "v2beta");
    const prefix = versionIndex >= 0 ? parts.slice(0, versionIndex) : parts;
    url.pathname = `/${[...prefix, ...targetPath.split("/").filter(Boolean)].join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${targetPath.replace(/^\/+/, "")}`;
  }
}

function isStabilityV1Base(baseUrl: string): boolean {
  try {
    const parts = new URL(baseUrl).pathname.split("/").filter(Boolean);
    return parts.includes("v1") && !parts.includes("v2beta");
  } catch {
    return /\/v1(?:\/|$)/i.test(baseUrl) && !/\/v2beta(?:\/|$)/i.test(baseUrl);
  }
}

function knownStabilityImageModels() {
  return MODEL_LISTS.image_generation
    .filter((model) => {
      const id = model.id.toLowerCase();
      return id.startsWith("sd3") || id.startsWith("stable-image");
    })
    .map((model) => ({ id: model.id, name: model.name }));
}

export async function connectionsRoutes(app: FastifyInstance) {
  const storage = createConnectionsStorage(app.db);

  app.get("/", async () => {
    return storage.list();
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const conn = await storage.getById(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    // Mask key in response
    return { ...conn, apiKeyEncrypted: conn.apiKeyEncrypted ? "••••••••" : "" };
  });

  app.post("/", async (req) => {
    const input = createConnectionSchema.parse(req.body);
    return storage.create(input);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const data = createConnectionSchema.partial().parse(req.body);
    return storage.update(req.params.id, data);
  });

  // Save default generation parameters for a connection
  app.put<{ Params: { id: string } }>("/:id/default-parameters", async (req, reply) => {
    const conn = await storage.getById(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    const raw = req.body;
    if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
      return reply.status(400).send({ error: "Body must be a JSON object or null" });
    }
    const params = raw as Record<string, unknown> | null;
    await storage.updateDefaultParameters(req.params.id, params);
    return { success: true };
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });

  // Duplicate a connection (copies everything including the encrypted API key)
  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    const result = await storage.duplicate(req.params.id);
    if (!result) return reply.status(404).send({ error: "Connection not found" });
    return result;
  });

  // Test connection (sends a tiny ping to the API)
  app.post<{ Params: { id: string } }>("/:id/test", async (req, reply) => {
    const conn = await storage.getWithKey(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });

    const start = Date.now();
    try {
      // Claude (Subscription) has no HTTP endpoint — verify the local SDK
      // can be loaded and that an auth source exists, then return success.
      if (conn.provider === "claude_subscription") {
        try {
          await import("@anthropic-ai/claude-agent-sdk");
        } catch (err) {
          return {
            success: false,
            message: `Claude Agent SDK unavailable: ${err instanceof Error ? err.message : "Unknown error"}`,
            latencyMs: Date.now() - start,
            modelName: null,
          };
        }
        return {
          success: true,
          message: "Claude Agent SDK loaded. The first chat will fail if `claude login` has not been run on this host.",
          latencyMs: Date.now() - start,
          modelName: conn.model,
        };
      }

      // Simple models list fetch to verify the key works
      const { PROVIDERS } = await import("@marinara-engine/shared");
      const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      let baseUrl = conn.baseUrl || provider?.defaultBaseUrl || "";

      if (!baseUrl) {
        return {
          success: false,
          message: "No base URL configured for this provider",
          latencyMs: 0,
          modelName: null,
        };
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider?.usesAuthHeader) {
        headers["Authorization"] = `Bearer ${conn.apiKey}`;
      }
      if (provider?.apiKeyHeader) {
        headers[provider.apiKeyHeader] = conn.apiKey;
      }

      const imageSource =
        conn.provider === "image_generation" ? resolveImageGenerationSource(conn as any, baseUrl) : "";
      baseUrl = normalizeConnectionTestBaseUrl(baseUrl, conn.provider);
      // image_generation has no standard modelsEndpoint — use provider-specific checks
      let testUrl: string;
      if (conn.provider === "image_generation" && imageSource === "novelai") {
        // NovelAI: validate the API key via the user subscription endpoint
        testUrl = "https://api.novelai.net/user/subscription";
      } else if (conn.provider === "image_generation" && imageSource === "stability") {
        // Stability's generation endpoints live under v2beta, but account/key checks are v1.
        testUrl = buildStabilityUrl(baseUrl, "v1/user/account");
      } else if (conn.provider === "image_generation" && imageSource === "comfyui") {
        // ComfyUI: ping the system stats endpoint
        testUrl = `${baseUrl}/system_stats`;
      } else if (conn.provider === "image_generation" && imageSource === "automatic1111") {
        // AUTOMATIC1111 / SD Web UI: ping the internal ping endpoint
        testUrl = `${baseUrl}/sdapi/v1/options`;
      } else {
        testUrl = `${baseUrl}${provider?.modelsEndpoint || "/models"}`;
      }

      const res = await safeFetch(testUrl, {
        headers,
        policy: localUrlPolicyForProvider(conn.provider, imageSource),
        maxResponseBytes: 2 * 1024 * 1024,
      });
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return { success: true, message: "Connection successful", latencyMs, modelName: conn.model };
      } else {
        const body = await res.text();
        return {
          success: false,
          message: `API returned ${res.status}: ${body.slice(0, 200)}`,
          latencyMs,
          modelName: null,
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        latencyMs: Date.now() - start,
        modelName: null,
      };
    }
  });

  // ── Fetch available models from the provider API ──
  app.get<{ Params: { id: string } }>("/:id/models", async (req, reply) => {
    const conn = await storage.getWithKey(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });

    try {
      // Claude (Subscription) has no remote /models endpoint — return the
      // curated static list for the subscription path.
      if (conn.provider === "claude_subscription") {
        const { MODEL_LISTS } = await import("@marinara-engine/shared");
        const models = MODEL_LISTS.claude_subscription.map((m) => ({ id: m.id, name: m.name }));
        return { models };
      }

      const { PROVIDERS } = await import("@marinara-engine/shared");
      const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      let baseUrl = conn.baseUrl || provider?.defaultBaseUrl || "";

      if (!baseUrl) {
        return reply.status(400).send({ error: "No base URL configured" });
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider?.usesAuthHeader) {
        headers["Authorization"] = `Bearer ${conn.apiKey}`;
      }
      if (provider?.apiKeyHeader) {
        headers[provider.apiKeyHeader] = conn.apiKey;
      }

      // Anthropic requires version header for models endpoint
      if (conn.provider === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
      }

      // ── Special handling for local image gen services ──
      const imageSource =
        conn.provider === "image_generation" ? resolveImageGenerationSource(conn as any, baseUrl) : "";
      baseUrl = normalizeConnectionTestBaseUrl(baseUrl, conn.provider);
      const lowerBase = baseUrl.toLowerCase();
      const sanitizeProviderBody = (body: string): string => {
        if (body.includes("<html") || body.includes("<!DOCTYPE")) {
          return "Provider returned an HTML page instead of JSON. Check the Base URL for this image service.";
        }
        return body.slice(0, 300);
      };

      // Stability AI: v2beta has task-specific generation endpoints, not /models.
      // Validate the key via v1 account, then either fetch legacy v1 engines or return the curated v2beta list.
      if (conn.provider === "image_generation" && imageSource === "stability") {
        const accountRes = await safeFetch(buildStabilityUrl(baseUrl, "v1/user/account"), {
          headers,
          policy: localUrlPolicyForProvider(conn.provider, imageSource),
          maxResponseBytes: 2 * 1024 * 1024,
        });
        if (!accountRes.ok) {
          const body = await accountRes.text();
          return reply.status(502).send({
            error: `Stability AI returned ${accountRes.status}: ${sanitizeProviderBody(body)}`,
          });
        }

        if (isStabilityV1Base(baseUrl)) {
          const res = await safeFetch(buildStabilityUrl(baseUrl, "v1/engines/list"), {
            headers,
            policy: localUrlPolicyForProvider(conn.provider, imageSource),
            maxResponseBytes: 5 * 1024 * 1024,
          });
          if (!res.ok) {
            const body = await res.text();
            return reply.status(502).send({
              error: `Stability AI returned ${res.status}: ${sanitizeProviderBody(body)}`,
            });
          }

          const text = await res.text();
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            return reply.status(502).send({
              error: `Failed to fetch models: ${sanitizeProviderBody(text)}`,
            });
          }

          const engines = Array.isArray(json)
            ? json
            : Array.isArray((json as { engines?: unknown }).engines)
              ? (json as { engines: unknown[] }).engines
              : [];
          const models = engines
            .map((engine) => {
              if (!engine || typeof engine !== "object") return null;
              const record = engine as { id?: string; name?: string; description?: string };
              const id = record.id ?? "";
              return id ? { id, name: record.name ?? record.description ?? id } : null;
            })
            .filter((model): model is { id: string; name: string } => Boolean(model));
          return { models: models.length ? models : knownStabilityImageModels() };
        }

        return { models: knownStabilityImageModels() };
      }

      // ComfyUI: fetch checkpoints from object_info
      if (conn.provider === "image_generation" && imageSource === "comfyui") {
        const res = await safeFetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
          policy: localUrlPolicyForProvider(conn.provider, imageSource),
          maxResponseBytes: 5 * 1024 * 1024,
        });
        if (!res.ok) {
          return reply.status(502).send({ error: `ComfyUI returned ${res.status}` });
        }
        const info = (await res.json()) as {
          CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
        };
        const ckpts = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
        return { models: ckpts.map((name: string) => ({ id: name, name })) };
      }

      // AUTOMATIC1111 / SD Web UI: fetch models from /sdapi/v1/sd-models
      if (conn.provider === "image_generation" && imageSource === "automatic1111") {
        const res = await safeFetch(`${baseUrl}/sdapi/v1/sd-models`, {
          policy: localUrlPolicyForProvider(conn.provider, imageSource),
          maxResponseBytes: 5 * 1024 * 1024,
        });
        if (!res.ok) {
          return reply.status(502).send({ error: `SD Web UI returned ${res.status}` });
        }
        const sdModels = (await res.json()) as Array<{ title?: string; model_name?: string }>;
        return {
          models: sdModels
            .map((m) => ({ id: m.title ?? m.model_name ?? "", name: m.title ?? m.model_name ?? "" }))
            .filter((m) => m.id),
        };
      }

      if (conn.provider === "image_generation" && lowerBase.includes("nano-gpt.com")) {
        const res = await safeFetch(`${baseUrl}/image-models`, {
          headers,
          policy: {
            allowLocal: isProviderLocalUrlsEnabled(),
            allowLoopback: true,
            allowMdns: true,
            allowedProtocols: ["https:", "http:"],
            flagName: "PROVIDER_LOCAL_URLS_ENABLED",
          },
          maxResponseBytes: 5 * 1024 * 1024,
        });
        if (!res.ok) {
          const body = await res.text();
          return reply.status(502).send({ error: `Provider returned ${res.status}: ${sanitizeProviderBody(body)}` });
        }
        const text = await res.text();
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return reply.status(502).send({
            error: `Failed to fetch models: ${sanitizeProviderBody(text)}`,
          });
        }
        const data = (json.data ?? []) as Array<{ id?: string; name?: string }>;
        return {
          models: data.map((m) => ({ id: m.id ?? "", name: m.name ?? m.id ?? "" })).filter((m) => m.id),
        };
      }

      let modelsUrl = `${baseUrl}${provider?.modelsEndpoint ?? "/models"}`;
      if (conn.provider === "google") {
        modelsUrl += `?key=${conn.apiKey}`;
      }

      const res = await safeFetch(modelsUrl, {
        headers,
        policy: {
          allowLocal: isProviderLocalUrlsEnabled(),
          allowLoopback: true,
          allowMdns: true,
          allowedProtocols: ["https:", "http:"],
          flagName: "PROVIDER_LOCAL_URLS_ENABLED",
        },
        maxResponseBytes: 5 * 1024 * 1024,
      });
      if (!res.ok) {
        const body = await res.text();
        return reply.status(502).send({
          error: `Provider returned ${res.status}: ${sanitizeProviderBody(body)}`,
        });
      }

      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return reply.status(502).send({
          error: `Failed to fetch models: ${sanitizeProviderBody(text)}`,
        });
      }

      // Normalize across providers
      const models = normalizeModelsResponse(conn.provider, json);
      return { models };
    } catch (err) {
      return reply.status(502).send({
        error: `Failed to fetch models: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });

  // ── Test image generation — generates a small fixed test image ──
  app.post<{ Params: { id: string } }>("/:id/test-image", async (req, reply) => {
    const conn = await storage.getWithKey(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });
    if (conn.provider !== "image_generation") {
      return reply.status(400).send({ error: "Not an image generation connection" });
    }

    const { PROVIDERS } = await import("@marinara-engine/shared");
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    const baseUrl = (conn.baseUrl || providerDef?.defaultBaseUrl || "").replace(/\/+$/, "");

    const { generateImage } = await import("../services/image/image-generation.js");
    const imgModel = conn.model || "";
    const imgApiKey = conn.apiKey || "";
    const imgSource = conn.imageGenerationSource || imgModel;
    const imgServiceHint = conn.imageService || imgSource;
    const imageDefaults = resolveConnectionImageDefaults(conn);

    const BASE_PROMPT = "plate of spaghetti with marinara sauce";

    const start = Date.now();
    try {
      const result = await generateImage(imgSource, baseUrl, imgApiKey, imgServiceHint, {
        prompt: BASE_PROMPT,
        model: imgModel || undefined,
        width: 512,
        height: 512,
        comfyWorkflow: conn.comfyuiWorkflow || undefined,
        imageDefaults,
      });
      return {
        success: true,
        base64: result.base64,
        mimeType: result.mimeType,
        latencyMs: Date.now() - start,
        prompt: BASE_PROMPT,
      };
    } catch (err) {
      return {
        success: false,
        base64: null,
        mimeType: null,
        latencyMs: Date.now() - start,
        prompt: BASE_PROMPT,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  // ── Test message — sends "hi" to the model and returns the response ──
  app.post<{ Params: { id: string } }>("/:id/test-message", async (req, reply) => {
    const conn = await storage.getWithKey(req.params.id);
    if (!conn) return reply.status(404).send({ error: "Connection not found" });

    if (!conn.model) {
      return reply.status(400).send({ error: "No model configured. Set a model first." });
    }

    const { PROVIDERS } = await import("@marinara-engine/shared");
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    const baseUrl = (conn.baseUrl || providerDef?.defaultBaseUrl || "").replace(/\/+$/, "");

    // Claude (Subscription) is HTTP-less — the SDK manages the endpoint, so
    // skip the baseUrl precondition. Every other provider still requires one.
    if (!baseUrl && conn.provider !== "claude_subscription") {
      return reply.status(400).send({ error: "No base URL configured" });
    }

    const start = Date.now();
    try {
      const provider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
      );

      let fullResponse = "";
      for await (const chunk of provider.chat([{ role: "user", content: "hi" }], {
        model: conn.model,
        temperature: 0.7,
        maxTokens: 200,
        stream: false,
      })) {
        fullResponse += chunk;
      }

      const latencyMs = Date.now() - start;
      return {
        success: true,
        response: fullResponse.slice(0, 500),
        latencyMs,
        model: conn.model,
      };
    } catch (err) {
      return {
        success: false,
        response: "",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown error",
        model: conn.model,
      };
    }
  });
}

// ──────────────────────────────────────────────
// Normalize models response from different providers
// ──────────────────────────────────────────────
interface RemoteModel {
  id: string;
  name: string;
}

function normalizeModelsResponse(provider: string, json: Record<string, unknown>): RemoteModel[] {
  switch (provider) {
    case "google": {
      // Google returns { models: [{ name: "models/gemini-...", displayName: "..." }] }
      const models = (json.models ?? []) as Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
      return models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => ({
          id: (m.name ?? "").replace(/^models\//, ""),
          name: m.displayName ?? (m.name ?? "").replace(/^models\//, ""),
        }))
        .filter((m) => m.id);
    }

    case "anthropic": {
      // Anthropic returns { data: [{ id: "claude-...", display_name: "..." }] }
      const data = (json.data ?? []) as Array<{
        id?: string;
        display_name?: string;
        type?: string;
      }>;
      return data
        .filter((m) => m.type === "model" || m.id)
        .map((m) => ({
          id: m.id ?? "",
          name: m.display_name ?? m.id ?? "",
        }))
        .filter((m) => m.id);
    }

    case "cohere": {
      // Cohere native v2 returns { models: [{ name: "command-r-plus", ... }] }.
      // The OpenAI compatibility endpoint returns { data: [{ id: "command-r-plus", ... }] }.
      const data = (json.data ?? []) as Array<{
        id?: string;
        name?: string;
      }>;
      if (data.length > 0) {
        return data.map((m) => ({ id: m.id ?? "", name: m.name ?? m.id ?? "" })).filter((m) => m.id);
      }

      const models = (json.models ?? []) as Array<{
        name?: string;
        endpoints?: string[];
      }>;
      return models
        .filter((m) => m.endpoints?.includes("chat"))
        .map((m) => ({
          id: m.name ?? "",
          name: m.name ?? "",
        }))
        .filter((m) => m.id);
    }

    default: {
      // OpenAI-compatible: { data: [{ id: "gpt-4o", ... }] }
      // This covers openai, mistral, openrouter, custom
      const data = (json.data ?? []) as Array<{
        id?: string;
        name?: string;
      }>;
      return data
        .map((m) => ({
          id: m.id ?? "",
          name: m.name ?? m.id ?? "",
        }))
        .filter((m) => m.id);
    }
  }
}
