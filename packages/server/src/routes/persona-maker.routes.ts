// ──────────────────────────────────────────────
// Routes: Persona Maker (AI Generation via SSE)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";

const personaMakerSchema = z.object({
  prompt: z.string().min(1),
  connectionId: z.string().min(1),
  streaming: z.boolean().optional().default(true),
});

const SYSTEM_PROMPT = `You are a creative persona designer for roleplay and fiction. Given a short description or concept, generate a complete user persona in JSON format. A persona represents the user's in-world identity — the character they play as.

Return ONLY valid JSON with these fields:
{
  "name": "The persona's name",
  "description": "A rich description of who this persona is — their identity, role, motivations, and how others perceive them (1-3 paragraphs).",
  "personality": "Concise personality summary — key traits, temperament, mannerisms, quirks (1-2 sentences).",
  "scenario": "The default scenario or setting this persona inhabits.",
  "backstory": "The persona's history, origin story, and formative events (2-3 paragraphs).",
  "appearance": "Detailed physical description — height, build, hair, eyes, clothing, distinguishing features."
}

Be creative, detailed, and consistent. Make the persona feel like a real person the user would enjoy embodying.`;

export async function personaMakerRoutes(app: FastifyInstance) {
  const connections = createConnectionsStorage(app.db);

  /**
   * POST /api/persona-maker/generate
   * Streams AI-generated persona data via SSE.
   */
  app.post("/generate", async (req, reply) => {
    const input = personaMakerSchema.parse(req.body);

    const conn = await connections.getWithKey(input.connectionId);
    if (!conn) {
      return reply.status(400).send({ error: "API connection not found" });
    }

    let baseUrl = conn.baseUrl;
    if (!baseUrl) {
      const { PROVIDERS } = await import("@marinara-engine/shared");
      const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      baseUrl = providerDef?.defaultBaseUrl ?? "";
    }
    // Claude (Subscription) uses the local Claude Agent SDK; no HTTP endpoint.
    if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
    if (!baseUrl) {
      return reply.status(400).send({ error: "No base URL configured for this connection" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    try {
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey, conn.maxContext, conn.openrouterProvider, conn.maxTokensOverride);
      let fullResponse = "";

      for await (const chunk of provider.chat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Create a persona based on: ${input.prompt}` },
        ],
        {
          model: conn.model,
          temperature: 1,
          maxTokens: 4096,
          stream: input.streaming,
        },
      )) {
        fullResponse += chunk;
        reply.raw.write(`data: ${JSON.stringify({ type: "token", data: chunk })}\n\n`);
      }

      let personaData: Record<string, unknown> | null = null;
      try {
        const jsonMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, fullResponse];
        const jsonStr = (jsonMatch[1] ?? fullResponse).trim();
        personaData = JSON.parse(jsonStr);
      } catch {
        personaData = null;
      }

      reply.raw.write(
        `data: ${JSON.stringify({
          type: "done",
          data: personaData ? JSON.stringify(personaData) : fullResponse,
        })}\n\n`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Persona generation failed";
      reply.raw.write(`data: ${JSON.stringify({ type: "error", data: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
