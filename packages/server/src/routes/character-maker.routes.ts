// ──────────────────────────────────────────────
// Routes: Character Maker (AI Generation via SSE)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";

const characterMakerSchema = z.object({
  prompt: z.string().min(1),
  connectionId: z.string().min(1),
  streaming: z.boolean().optional().default(true),
});

const SYSTEM_PROMPT = `You are a creative character designer for roleplay and fiction. Given a short description or concept, generate a complete character card in JSON format.

Return ONLY valid JSON with these fields:
{
  "name": "Character's full name",
  "description": "Rich, detailed character description (2-4 paragraphs). Include personality, motivations, mannerisms, speech patterns.",
  "personality": "Concise personality summary — key traits, temperament, quirks (1-2 sentences).",
  "scenario": "A default scenario/setting the character lives in or where interactions take place.",
  "first_mes": "The character's opening message/greeting when meeting someone new. Write in-character, 1-3 paragraphs. Use *asterisks* for actions.",
  "mes_example": "2-3 example dialogue exchanges. Format: <START>\\n{{user}}: message\\n{{char}}: reply",
  "creator_notes": "Brief note about the character concept and intended use.",
  "system_prompt": "A system prompt that guides the AI to roleplay this character accurately.",
  "post_history_instructions": "",
  "tags": ["tag1", "tag2", "tag3"],
  "backstory": "The character's history, origin, and key life events (2-3 paragraphs).",
  "appearance": "Detailed physical description — height, build, hair, eyes, clothing, distinguishing features."
}

Be creative, detailed, and consistent. Make the character feel alive and three-dimensional.`;

export async function characterMakerRoutes(app: FastifyInstance) {
  const connections = createConnectionsStorage(app.db);

  /**
   * POST /api/character-maker/generate
   * Streams AI-generated character data via SSE.
   */
  app.post("/generate", async (req, reply) => {
    const input = characterMakerSchema.parse(req.body);

    // Resolve connection
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

    // Set up SSE headers
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
          { role: "user", content: `Create a character based on: ${input.prompt}` },
        ],
        {
          model: conn.model,
          temperature: 1,
          maxTokens: 8192,
          stream: input.streaming,
        },
      )) {
        fullResponse += chunk;
        reply.raw.write(`data: ${JSON.stringify({ type: "token", data: chunk })}\n\n`);
      }

      // Try to parse the JSON from the response
      let characterData: Record<string, unknown> | null = null;
      try {
        // Extract JSON from potential markdown code blocks
        const jsonMatch = fullResponse.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, fullResponse];
        const jsonStr = (jsonMatch[1] ?? fullResponse).trim();
        characterData = JSON.parse(jsonStr);
      } catch {
        // If parsing fails, send raw text for client to handle
        characterData = null;
      }

      reply.raw.write(
        `data: ${JSON.stringify({
          type: "done",
          data: characterData ? JSON.stringify(characterData) : fullResponse,
        })}\n\n`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Character generation failed";
      reply.raw.write(`data: ${JSON.stringify({ type: "error", data: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
