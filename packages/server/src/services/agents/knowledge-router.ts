// ──────────────────────────────────────────────
// Knowledge Router Agent — Catalog-based entry selection
// ──────────────────────────────────────────────
// A lower-cost alternative to the knowledge-retrieval agent. Instead of
// summarizing every lorebook entry, the router reads a short catalog
// (entry id + name + summary) and returns the IDs of the entries it
// thinks are relevant to the current scene. The selected entries are
// then injected verbatim — no per-entry summarization pass.
//
// The summary used in the catalog is the entry's user-written
// `description` if non-empty, otherwise a fallback snippet of the
// entry's content (~60 tokens). This keeps the router useful out of
// the box for casual users while letting power users tune precision
// by writing tight descriptions.
// ──────────────────────────────────────────────
import type { AgentContext, AgentResult, LorebookEntry } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { executeAgent, type AgentExecConfig } from "./agent-executor.js";
import { logger } from "../../lib/logger.js";
import { scanForActivatedEntries, type ScanMessage, type ScanOptions } from "../lorebook/keyword-scanner.js";
import {
  semanticShortlistLorebookEntries,
  type LorebookEmbeddingOptions,
  type SemanticLorebookMatch,
} from "../lorebook/embeddings.js";

/** Approx ~4 chars per token for English text. Used for the content fallback budget. */
const FALLBACK_TOKEN_BUDGET = 60;
/** How many primary keys to surface per catalog entry. */
const KEYS_PER_ENTRY = 3;
/**
 * Maximum number of candidate entries the router will route over in a single
 * call. Prevents context-window blowups on extremely large lorebooks (e.g. a
 * 5,000-entry world bible would otherwise build a ~150k-token catalog and
 * either overflow smaller models or burn an enormous amount of input tokens).
 *
 * 400 is conservative — at the default ~30 tokens per catalog row plus
 * ~400 tokens of agent overhead, it stays comfortably under 13k input tokens
 * even before the conversation context. Real-world lorebooks rarely approach
 * this scale; when they do, the router truncates and logs a warning.
 */
const MAX_ROUTER_CANDIDATES = 400;
const DEFAULT_SEMANTIC_TOP_K = 40;

/** Single catalog row the LLM sees for routing. */
export interface CatalogItem {
  id: string;
  name: string;
  keys: string[];
  /** Short summary — user-written description, or content fallback. */
  summary: string;
}

interface RouterResponse {
  entryIds: string[];
}

export interface KnowledgeRouterCandidateOptions extends LorebookEmbeddingOptions {
  semanticTopK?: unknown;
  scanMessages?: ScanMessage[];
  scanOptions?: Pick<
    ScanOptions,
    | "gameState"
    | "activeCharacterIds"
    | "activeCharacterTags"
    | "generationTriggers"
    | "additionalMatchingSourceText"
    | "random"
  >;
  activatedEntries?: LorebookEntry[];
  keywordScanEntries?: LorebookEntry[];
}

/** Take the first ~N tokens of text (rough char-count approximation). */
function firstNTokens(text: string, n: number): string {
  return text.slice(0, n * 4).trim();
}

/**
 * Build the catalog the router sees. For each entry:
 *   - If `description` is non-empty, use it verbatim.
 *   - Otherwise fall back to the first ~60 tokens of content.
 *   - If both are empty, the entry still appears with name + keys only.
 */
export function buildCatalog(entries: LorebookEntry[]): CatalogItem[] {
  return entries.map((entry) => {
    const description = entry.description?.trim() ?? "";
    const summary = description.length > 0 ? description : firstNTokens(entry.content, FALLBACK_TOKEN_BUDGET);
    return {
      id: entry.id,
      name: entry.name,
      keys: (entry.keys ?? []).slice(0, KEYS_PER_ENTRY),
      summary,
    };
  });
}

/** Render the catalog as the text the LLM sees inside <entry_catalog> tags. */
export function formatCatalogForPrompt(items: CatalogItem[]): string {
  return items
    .map((item) => {
      const keyAttr = item.keys.length > 0 ? ` keys="${escapeXmlAttr(item.keys.join(", "))}"` : "";
      const body = item.summary.length > 0 ? escapeXmlText(item.summary) : "(no description)";
      return `<entry id="${escapeXmlAttr(item.id)}" name="${escapeXmlAttr(item.name)}"${keyAttr}>\n${body}\n</entry>`;
    })
    .join("\n");
}

/** Escape characters that would break an XML attribute value (double-quote delimited). */
function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape characters that would break XML element content. Notably we don't have
 * to escape `"` here (no attribute delimiter context), but `&` and `<` would
 * still confuse a parser.
 */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Parse the LLM response into a list of entry IDs.
 * Tolerates markdown code fences and extra prose around the JSON.
 */
export function parseRouterResponse(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Strip ```json … ``` or ``` … ``` fences if the model wrapped its output.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1]! : trimmed;

  // Find the first { and last } to be robust to leading/trailing prose.
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return [];
  const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(jsonSlice) as RouterResponse;
    if (!parsed || !Array.isArray(parsed.entryIds)) return [];
    // Trim each id — the model occasionally returns `" entry-1 "` or includes
    // a trailing newline. Whitespace would survive the type check below but
    // fail the exact Map.get lookup at the executor layer.
    return parsed.entryIds
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id): id is string => id.length > 0);
  } catch {
    return [];
  }
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.max(1, Math.trunc(numeric));
}

export function buildKnowledgeRouterQuery(context: AgentContext): string {
  const parts = context.recentMessages.slice(-10).map((message) => message.content.trim()).filter(Boolean);
  if (context.chatSummary?.trim()) parts.unshift(context.chatSummary.trim());
  if (context.recalledSummaries?.trim()) parts.unshift(context.recalledSummaries.trim());
  if (context.gameState) parts.push(JSON.stringify(context.gameState));
  return parts.join("\n\n");
}

export function buildKeywordActivatedRouterEntries(
  entries: LorebookEntry[],
  messages: ScanMessage[],
  options: KnowledgeRouterCandidateOptions["scanOptions"] = {},
): LorebookEntry[] {
  return scanForActivatedEntries(messages, entries, { ...options, scanDepth: 0, ignoreTiming: true }).map(
    (activated) => activated.entry,
  );
}

export function mergeKnowledgeRouterCandidates(
  semanticMatches: SemanticLorebookMatch[],
  activatedEntries: LorebookEntry[],
): LorebookEntry[] {
  const candidates: LorebookEntry[] = [];
  const seen = new Set<string>();
  for (const match of semanticMatches) {
    if (seen.has(match.entry.id)) continue;
    seen.add(match.entry.id);
    candidates.push(match.entry);
  }
  for (const entry of activatedEntries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    candidates.push(entry);
  }
  return candidates;
}

export async function prepareKnowledgeRouterCandidates(
  entries: LorebookEntry[],
  context: AgentContext,
  options: KnowledgeRouterCandidateOptions = {},
): Promise<LorebookEntry[]> {
  if (entries.length === 0) return [];
  const scanMessages = options.scanMessages ?? context.recentMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const activatedEntries =
    options.activatedEntries ??
    buildKeywordActivatedRouterEntries(options.keywordScanEntries ?? entries, scanMessages, options.scanOptions);
  const keywordScanEntries =
    options.activatedEntries && options.keywordScanEntries
      ? buildKeywordActivatedRouterEntries(options.keywordScanEntries, scanMessages, options.scanOptions)
      : [];
  const fallbackCandidates = mergeKnowledgeRouterCandidates([], [
    ...activatedEntries,
    ...keywordScanEntries,
    ...entries,
  ]);
  const query = buildKnowledgeRouterQuery(context);
  let semanticMatches: SemanticLorebookMatch[] | null;
  try {
    semanticMatches = await semanticShortlistLorebookEntries(entries, query, {
      topK: normalizePositiveInteger(options.semanticTopK, DEFAULT_SEMANTIC_TOP_K),
      localEmbedder: options.localEmbedder,
      embeddingSource: options.embeddingSource,
    });
  } catch (err) {
    logger.warn(err, "[knowledge-router] semantic shortlist failed; using fallback candidates");
    return fallbackCandidates;
  }

  if (semanticMatches === null) {
    logger.debug("[knowledge-router] semantic shortlist unavailable; using filtered router entries");
    return fallbackCandidates;
  }

  const candidates = mergeKnowledgeRouterCandidates(semanticMatches, [...activatedEntries, ...keywordScanEntries]);
  if (candidates.length === 0) return entries;
  return candidates;
}

/**
 * Execute the knowledge-router agent.
 *
 *   1. Build a catalog (one short row per candidate entry).
 *   2. Run the agent LLM with the catalog injected as <entry_catalog>.
 *   3. Parse {"entryIds": [...]} from the response.
 *   4. Look up the selected entries and return their content verbatim,
 *      joined into a single context_injection text block.
 *
 * The route layer is responsible for pre-filtering entries (e.g. dropping
 * `constant: true` entries — those are already injected unconditionally
 * by the standard activation pipeline, so routing them would duplicate).
 */
export async function executeKnowledgeRouter(
  config: AgentExecConfig,
  baseContext: AgentContext,
  provider: BaseLLMProvider,
  model: string,
  entries: LorebookEntry[],
  options: KnowledgeRouterCandidateOptions = {},
): Promise<AgentResult> {
  const startTime = Date.now();

  // Empty input → no work, no LLM call.
  if (entries.length === 0) {
    return {
      agentId: config.id,
      agentType: config.type,
      type: "context_injection",
      data: { text: "" },
      tokensUsed: 0,
      durationMs: Date.now() - startTime,
      success: true,
      error: null,
    };
  }

  const routerEntries = await prepareKnowledgeRouterCandidates(entries, baseContext, {
    ...options,
    semanticTopK: options.semanticTopK ?? config.settings.semanticTopK,
  });

  // Cap candidates to protect against context-window blowups on huge lorebooks.
  // The router still works on truncated input — it just sees the first N entries.
  // A future enhancement could rank or paginate before truncating; for now the
  // truncation is order-preserving (matches `listEntriesByLorebooks` order).
  const candidates =
    routerEntries.length > MAX_ROUTER_CANDIDATES ? routerEntries.slice(0, MAX_ROUTER_CANDIDATES) : routerEntries;
  if (routerEntries.length > MAX_ROUTER_CANDIDATES) {
    logger.warn(
      "[knowledge-router] catalog truncated to %d/%d entries (MAX_ROUTER_CANDIDATES)",
      candidates.length,
      routerEntries.length,
    );
  }

  const catalog = buildCatalog(candidates);
  const catalogText = formatCatalogForPrompt(catalog);

  const context: AgentContext = {
    ...baseContext,
    memory: {
      ...baseContext.memory,
      _routerCatalog: catalogText,
    },
  };

  const result = await executeAgent(config, context, provider, model);

  if (!result.success) {
    // result.error is `string | null` per AgentResult — wrap in an Error so Pino
    // can serialize a stack-aware payload via its err-first signature.
    const err = new Error(result.error ?? "unknown error");
    logger.error(err, "[knowledge-router] agent execution failed");
    return result;
  }

  const responseText =
    typeof result.data === "string" ? result.data : ((result.data as { text?: string } | null)?.text ?? "");
  const selectedIds = parseRouterResponse(responseText);

  // Dedupe IDs in case the model repeats one — we don't want to inject the same
  // entry's content twice (token waste + confusing context).
  const dedupedIds = [...new Set(selectedIds)];

  // Build the verbatim injection text from the entries the router picked.
  // Lookup is restricted to `candidates` (the truncated set the LLM actually saw)
  // so a hallucinated id from outside that set can't slip through.
  const entriesById = new Map(candidates.map((e) => [e.id, e]));
  const selectedEntries = dedupedIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is LorebookEntry => entry !== undefined);

  if (selectedEntries.length === 0) {
    logger.debug("[knowledge-router] no entries selected from %d candidates", candidates.length);
    return {
      ...result,
      type: "context_injection",
      data: { text: "" },
    };
  }

  const injectionText = selectedEntries.map((entry) => `### ${entry.name}\n${entry.content}`).join("\n\n");

  logger.debug(
    "[knowledge-router] selected %d/%d entries (%d ids returned, %d unique, %d unknown)",
    selectedEntries.length,
    candidates.length,
    selectedIds.length,
    dedupedIds.length,
    dedupedIds.length - selectedEntries.length,
  );

  return {
    ...result,
    type: "context_injection",
    data: { text: injectionText },
  };
}
