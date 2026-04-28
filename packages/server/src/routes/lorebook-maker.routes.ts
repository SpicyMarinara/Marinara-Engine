// ──────────────────────────────────────────────
// Routes: Lorebook Maker (AI Generation via SSE)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";

const lorebookMakerSchema = z.object({
  prompt: z.string().min(1),
  connectionId: z.string().min(1),
  streaming: z.boolean().optional().default(true),
  /** Optionally attach generated entries to an existing lorebook */
  lorebookId: z.string().optional(),
  /** Number of entries to generate */
  entryCount: z.number().int().min(1).max(200).default(10),
});

const BATCH_SIZE = 15;

const SYSTEM_PROMPT = `You are a world-building assistant for roleplay and fiction. Given a topic or concept, generate a set of lorebook entries that flesh out the world. Each entry should activate when relevant keywords appear in conversation.

Return ONLY valid JSON — an object with these fields:
{
  "lorebook_name": "Short descriptive name for this lorebook",
  "lorebook_description": "One paragraph overview of what this lorebook covers",
  "category": "world" | "character" | "npc" | "uncategorized",
  "entries": [
    {
      "name": "Entry title",
      "content": "The lore content that gets injected into context. Be detailed, 1-3 paragraphs. Write in a neutral, encyclopedic style suitable for an AI to reference.",
      "keys": ["keyword1", "keyword2"],
      "secondary_keys": [],
      "tag": "optional tag like 'location', 'item', 'faction', 'history', 'magic'",
      "constant": false,
      "order": 100
    }
  ]
}

Guidelines:
- Each entry should have 2-5 relevant keywords that would naturally appear in RP conversation
- Content should be written as world-info — facts, descriptions, rules — not dialogue
- Make entries self-contained but interconnected
- Vary the tags across entries (locations, characters, items, factions, history, etc.)
- Set "constant": true only for the most fundamental world rules (max 1-2 entries)
- Use increasing order values (100, 200, 300…) so entries inject in logical order`;

/** Try to extract & parse JSON from a raw LLM response (handles ```json fences). */
function tryParseLorebookJSON(raw: string): Record<string, unknown> | null {
  // Strategy 1: Extract from markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      /* continue to next strategy */
    }
  }

  // Strategy 2: Find the outermost { ... } block
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch {
      /* continue to next strategy */
    }
  }

  // Strategy 3: Try parsing raw text directly
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

/** Normalise raw parsed entries into a consistent shape. */
function normaliseEntries(rawEntries: unknown[]) {
  return rawEntries.map((raw: unknown) => {
    const e = raw as Record<string, unknown>;
    return {
      name: String(e.name ?? "Untitled"),
      content: String(e.content ?? ""),
      keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
      secondaryKeys: Array.isArray(e.secondary_keys) ? e.secondary_keys.map(String) : [],
      tag: String(e.tag ?? ""),
      constant: e.constant === true,
      order: typeof e.order === "number" ? e.order : 100,
    };
  });
}

export async function lorebookMakerRoutes(app: FastifyInstance) {
  const connections = createConnectionsStorage(app.db);
  const lorebooks = createLorebooksStorage(app.db);

  /**
   * POST /api/lorebook-maker/generate
   * Streams AI-generated lorebook data via SSE.
   * Automatically batches large requests (> BATCH_SIZE entries).
   */
  app.post("/generate", async (req, reply) => {
    const input = lorebookMakerSchema.parse(req.body);

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

    /** Helper to send an SSE event. */
    const send = (type: string, data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    try {
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey, conn.maxContext, conn.openrouterProvider, conn.maxTokensOverride);

      // ── Decide whether to batch ──
      const totalEntries = input.entryCount;
      const needsBatching = totalEntries > BATCH_SIZE;
      const batches: number[] = [];
      if (needsBatching) {
        let remaining = totalEntries;
        while (remaining > 0) {
          batches.push(Math.min(remaining, BATCH_SIZE));
          remaining -= BATCH_SIZE;
        }
      } else {
        batches.push(totalEntries);
      }

      const totalBatches = batches.length;
      const allEntries: unknown[] = [];
      let lorebookName = "";
      let lorebookDescription = "";
      let lorebookCategory = "";

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchSize = batches[batchIdx];

        // Notify client of batch progress
        if (needsBatching) {
          send("batch_start", {
            batch: batchIdx + 1,
            totalBatches,
            batchSize,
            entriesSoFar: allEntries.length,
            totalEntries,
          });
        }

        // Build user prompt
        let userPrompt: string;
        if (batchIdx === 0) {
          userPrompt = `Generate exactly ${batchSize} lorebook entries based on: ${input.prompt}`;
        } else {
          const existingNames = allEntries
            .map((e) => (e as Record<string, unknown>).name)
            .filter(Boolean)
            .join(", ");
          userPrompt =
            `Generate exactly ${batchSize} NEW lorebook entries based on: ${input.prompt}\n\n` +
            `You've already generated these entries: ${existingNames}\n` +
            `Create DIFFERENT entries that complement the above. Do NOT repeat any existing entries. ` +
            `Continue the order values from ${allEntries.length * 100 + 100}.`;
        }

        // Attempt generation with 1 retry on parse failure
        let batchEntries: unknown[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          let batchResponse = "";
          for await (const chunk of provider.chat(
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            {
              model: conn.model,
              temperature: 1,
              maxTokens: 16384,
              stream: input.streaming,
            },
          )) {
            batchResponse += chunk;
            send("token", chunk);
          }

          // Parse this batch
          const parsed = tryParseLorebookJSON(batchResponse);
          batchEntries =
            parsed && Array.isArray((parsed as { entries?: unknown[] }).entries)
              ? (parsed as { entries: unknown[] }).entries
              : [];

          // Capture metadata from first batch
          if (batchIdx === 0 && attempt === 0 && parsed) {
            lorebookName = String((parsed as Record<string, unknown>).lorebook_name ?? "");
            lorebookDescription = String((parsed as Record<string, unknown>).lorebook_description ?? "");
            lorebookCategory = String((parsed as Record<string, unknown>).category ?? "");
          }

          if (batchEntries.length > 0) break;

          // Parsing failed — retry once
          if (attempt === 0) {
            send("batch_warning", {
              batch: batchIdx + 1,
              message: "Failed to parse batch output, retrying…",
            });
            // Add a separator in the token stream
            send("token", "\n\n── Retrying batch… ──\n\n");
          }
        }

        if (batchEntries.length === 0) {
          send("batch_warning", {
            batch: batchIdx + 1,
            message: `Batch ${batchIdx + 1} failed to produce valid entries after retry.`,
          });
        }

        allEntries.push(...batchEntries);

        // Notify client this batch is done
        if (needsBatching) {
          send("batch_done", {
            batch: batchIdx + 1,
            totalBatches,
            batchEntryCount: batchEntries.length,
            totalEntriesSoFar: allEntries.length,
          });
        }
      }

      // Merge into final lorebook data
      const lorebookData: Record<string, unknown> = {
        lorebook_name: lorebookName || "AI Generated Lorebook",
        lorebook_description: lorebookDescription,
        category: lorebookCategory || "world",
        entries: allEntries,
      };

      // If a lorebookId was given, auto-save entries
      if (input.lorebookId && allEntries.length > 0) {
        try {
          const entriesToCreate = normaliseEntries(allEntries);
          await lorebooks.bulkCreateEntries(input.lorebookId!, entriesToCreate);
          send("saved", { count: entriesToCreate.length, lorebookId: input.lorebookId });
        } catch (saveErr) {
          send("save_error", saveErr instanceof Error ? saveErr.message : "Failed to save entries");
        }
      }

      send("done", JSON.stringify(lorebookData));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lorebook generation failed";
      send("error", message);
    } finally {
      reply.raw.end();
    }
  });
}
