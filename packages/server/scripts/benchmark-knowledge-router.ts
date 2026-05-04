// ──────────────────────────────────────────────
// Cost model: Knowledge Router vs Knowledge Retrieval
// ──────────────────────────────────────────────
// This is a developer tool, not a CI benchmark. It estimates the
// relative input-token cost of the two agents at different lorebook
// sizes so the trade-off is concrete in the PR description.
//
// HOW IT WORKS
// ────────────
// We do NOT call live LLMs (slow, costly, non-deterministic). Instead:
//   1. Generate a fake lorebook of N entries with realistic sizes.
//   2. Use the REAL `buildCatalog` to get the actual catalog tokens
//      a router would send.
//   3. Estimate KR's tokens analytically: it sees the full content of
//      every enabled entry, plus chunking overhead when the material
//      exceeds the agent's per-call context budget (default 6000).
//   4. Print a markdown table comparing input tokens + LLM-call counts.
//
// ASSUMPTIONS (documented so reviewers can challenge them)
// ────────────────────────────────────────────────────────
// - 4 chars per token (the same heuristic both agents use internally).
// - Avg entry content size: 800 chars (~200 tokens). Tunable below.
// - Description coverage: 50% of entries have a 1-sentence description
//   (~80 chars / ~20 tokens). The other 50% fall back to the first
//   ~60 tokens of content. This matches the expected "casual user
//   half-fills descriptions" baseline.
// - KR's chunk size: 6000 input tokens per call (the agent default).
// - Per-call fixed overhead (system prompt, conversation context):
//   ~600 tokens for KR, ~400 tokens for Router.
// - Router output: ~10 tokens per selected ID. Conservatively assume
//   it picks 20% of entries.
// - KR output: ~300 tokens per call (a summary).
//
// USAGE
// ─────
//   npx tsx scripts/benchmark-knowledge-router.ts
//
// Pipe the markdown table into the PR description.
// ──────────────────────────────────────────────
import type { LorebookEntry } from "@marinara-engine/shared";
import { buildCatalog, formatCatalogForPrompt } from "../src/services/agents/knowledge-router.js";

const CHARS_PER_TOKEN = 4;
const AVG_CONTENT_CHARS = 800; // ~200 tokens
const DESCRIPTION_CHARS = 80; // ~20 tokens
const DESCRIPTION_COVERAGE = 0.5; // 50% of entries have a description
const ROUTER_SELECTION_RATIO = 0.2; // router picks ~20% of entries
const KR_CHUNK_TOKENS = 6000;
const KR_OVERHEAD_TOKENS = 600;
const ROUTER_OVERHEAD_TOKENS = 400;
const KR_OUTPUT_TOKENS_PER_CALL = 300;
const ROUTER_OUTPUT_TOKENS_PER_ID = 10;

interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Generate a fake lorebook with N entries. Half get a description, half don't. */
function makeFakeLorebook(n: number): LorebookEntry[] {
  const entries: LorebookEntry[] = [];
  for (let i = 0; i < n; i++) {
    const hasDescription = i / n < DESCRIPTION_COVERAGE;
    entries.push({
      id: `entry-${i}`,
      lorebookId: "fake-book",
      name: `Entry ${i}`,
      content: "Lore content. ".repeat(Math.ceil(AVG_CONTENT_CHARS / 14)).slice(0, AVG_CONTENT_CHARS),
      description: hasDescription
        ? `Short summary for entry ${i} that the router can use.`.padEnd(DESCRIPTION_CHARS, " ")
        : "",
      keys: [`key${i}a`, `key${i}b`],
      secondaryKeys: [],
      enabled: true,
      constant: false,
      selective: false,
      selectiveLogic: "and",
      probability: null,
      scanDepth: null,
      matchWholeWords: false,
      caseSensitive: false,
      useRegex: false,
      characterFilterMode: "any",
      characterFilterIds: [],
      characterTagFilterMode: "any",
      characterTagFilters: [],
      generationTriggerFilterMode: "any",
      generationTriggerFilters: [],
      additionalMatchingSources: [],
      position: 0,
      depth: 4,
      order: 100,
      role: "system",
      sticky: null,
      cooldown: null,
      delay: null,
      ephemeral: null,
      group: "",
      groupWeight: null,
      locked: false,
      preventRecursion: false,
      tag: "",
      relationships: {},
      dynamicState: {},
      activationConditions: [],
      schedule: null,
      embedding: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return entries;
}

function estimateRouterCost(entries: LorebookEntry[]): CostBreakdown {
  const catalog = buildCatalog(entries);
  const catalogText = formatCatalogForPrompt(catalog);
  const catalogTokens = estimateTokens(catalogText);
  const inputTokens = catalogTokens + ROUTER_OVERHEAD_TOKENS;
  const selectedCount = Math.round(entries.length * ROUTER_SELECTION_RATIO);
  const outputTokens = selectedCount * ROUTER_OUTPUT_TOKENS_PER_ID;
  return {
    inputTokens,
    outputTokens,
    llmCalls: 1,
  };
}

function estimateRetrievalCost(entries: LorebookEntry[]): CostBreakdown {
  // KR sees the FULL content of every enabled entry, plus a header per entry.
  const formattedSizePerEntry = AVG_CONTENT_CHARS + 30; // "## name\n" header
  const totalMaterialChars = entries.length * formattedSizePerEntry;
  const totalMaterialTokens = Math.ceil(totalMaterialChars / CHARS_PER_TOKEN);

  // Chunk if it exceeds the per-call budget.
  const chunks = Math.max(1, Math.ceil(totalMaterialTokens / KR_CHUNK_TOKENS));
  const inputTokens = totalMaterialTokens + chunks * KR_OVERHEAD_TOKENS;
  const outputTokens = chunks * KR_OUTPUT_TOKENS_PER_CALL;
  return {
    inputTokens,
    outputTokens,
    llmCalls: chunks,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(value: number, baseline: number): string {
  if (baseline === 0) return "—";
  const ratio = value / baseline;
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Write a markdown line to stdout. We use process.stdout.write rather than
 * console.log because (a) the project's logging guidelines forbid console.* in
 * server code, and (b) Pino's structured output would muddy markdown intended
 * for piping into a PR description.
 */
function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function main(): void {
  const sizes = [20, 100, 500];

  writeLine("# Knowledge Router vs Knowledge Retrieval — cost model");
  writeLine();
  writeLine("Estimated input/output tokens per generation, using documented assumptions");
  writeLine("(see header comment in `benchmark-knowledge-router.ts` for the full list).");
  writeLine();
  writeLine(
    `Avg entry content: ${AVG_CONTENT_CHARS} chars (~${Math.round(AVG_CONTENT_CHARS / CHARS_PER_TOKEN)} tokens). ` +
      `Description coverage: ${(DESCRIPTION_COVERAGE * 100).toFixed(0)}%. ` +
      `KR chunk budget: ${KR_CHUNK_TOKENS} tokens.`,
  );
  writeLine();
  writeLine("| Entries | Knowledge Retrieval | Knowledge Router | Router vs KR (input) |");
  writeLine("|---|---|---|---|");

  for (const n of sizes) {
    const entries = makeFakeLorebook(n);
    const kr = estimateRetrievalCost(entries);
    const router = estimateRouterCost(entries);

    const krCell = `${fmt(kr.inputTokens)} in / ${fmt(kr.outputTokens)} out (${kr.llmCalls} call${kr.llmCalls === 1 ? "" : "s"})`;
    const routerCell = `${fmt(router.inputTokens)} in / ${fmt(router.outputTokens)} out (${router.llmCalls} call)`;
    const ratio = pct(router.inputTokens, kr.inputTokens);

    writeLine(`| ${n} | ${krCell} | ${routerCell} | ${ratio} |`);
  }

  writeLine();
  writeLine("**Read this as:** the smaller the Router % is, the bigger the savings.");
  writeLine("Output tokens are smaller for Router because it returns IDs rather than prose.");
  writeLine("LLM call count matters too — fewer calls = less wall-clock latency.");
  writeLine();
  writeLine("**Caveats:**");
  writeLine("- These are *modelled* costs, not measured. The model uses the same chunking logic");
  writeLine("  and token heuristics the agents use internally, but real LLM calls vary.");
  writeLine("- Router quality depends on description quality. With 0% description coverage the");
  writeLine("  router falls back to content snippets and accuracy drops; with 100% coverage and");
  writeLine("  good summaries the router approaches its best case.");
  writeLine("- KR's summarization may be MORE useful than verbatim entries on some queries.");
  writeLine("  This model captures cost, not quality.");
}

main();
