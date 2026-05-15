// ──────────────────────────────────────────────
// Lorebook Service: Orchestrator
// Ties together storage, scanning, and injection.
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { LIMITS } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import type {
  CharacterData,
  Lorebook,
  LorebookEntry,
  LorebookEntryTimingState,
  LorebookMatchingSource,
} from "@marinara-engine/shared";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import {
  scanForActivatedEntries,
  type ScanMessage,
  type ScanOptions,
  type GameStateForScanning,
  type ActivatedEntry,
  type EntryTimingState,
  updateTimingStatesForScan,
} from "./keyword-scanner.js";
import { applyTokenBudget, processActivatedEntries } from "./prompt-injector.js";

export interface LorebookScanResult {
  worldInfoBefore: string;
  worldInfoAfter: string;
  depthEntries: Array<{ content: string; role: "system" | "user" | "assistant"; depth: number; order: number }>;
  totalEntries: number;
  totalTokensEstimate: number;
  activatedEntryIds: string[];
  activatedEntries: Array<{ id: string; content: string }>;
  budgetSkippedEntries: LorebookBudgetSkippedEntry[];
  /** Updated per-chat entry state overrides (ephemeral countdown). Caller should persist to chat metadata. */
  updatedEntryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
  /** Updated per-chat timing states for sticky/cooldown/delay. Caller should persist to chat metadata. */
  updatedEntryTimingStates?: Record<string, LorebookEntryTimingState>;
}

export type LorebookBudgetSkipReason = "lorebook" | "chat" | "both";

export interface LorebookBudgetSkippedEntry {
  id: string;
  name: string;
  lorebookId: string;
  lorebookName: string;
  matchedKeys: string[];
  estimatedTokens: number;
  lorebookBudget: number;
  lorebookUsedTokens: number;
  chatBudget: number;
  chatUsedTokens: number;
  blockedBy: LorebookBudgetSkipReason;
}

type LorebookFilters = {
  chatId?: string;
  characterIds?: string[];
  personaId?: string | null;
  activeLorebookIds?: string[];
  excludedLorebookIds?: string[];
  excludedSourceAgentIds?: string[];
};

type RelevantLorebook = Pick<
  Lorebook,
  | "id"
  | "name"
  | "enabled"
  | "scanDepth"
  | "tokenBudget"
  | "recursiveScanning"
  | "maxRecursionDepth"
  | "isGlobal"
  | "characterId"
  | "characterIds"
  | "personaId"
  | "personaIds"
  | "chatId"
  | "sourceAgentId"
>;

type LorebookMatchingContext = {
  activeCharacterIds: string[];
  activeCharacterTags: string[];
  additionalMatchingSourceText: Partial<Record<LorebookMatchingSource, string>>;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => value.length > 0),
    ),
  );
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map(String));
  return uniqueStrings(safeJsonParse<string[]>(value, []));
}

function pushSourceText(
  target: Partial<Record<LorebookMatchingSource, string[]>>,
  source: LorebookMatchingSource,
  value: unknown,
) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  target[source] ??= [];
  target[source]!.push(trimmed);
}

async function buildLorebookMatchingContext(
  db: DB,
  characterIds: string[] | undefined,
  personaId: string | null | undefined,
  gameState: GameStateForScanning | null | undefined,
): Promise<LorebookMatchingContext> {
  const characters = createCharactersStorage(db);
  const activeCharacterIds = uniqueStrings([
    ...(characterIds ?? []),
    ...((gameState?.presentCharacters ?? []).map((character) => character.characterId) ?? []),
  ]);
  const sourceParts: Partial<Record<LorebookMatchingSource, string[]>> = {};
  const activeCharacterTags: string[] = [];

  for (const characterId of activeCharacterIds) {
    const row = await characters.getById(characterId);
    if (!row) continue;
    const data = safeJsonParse<CharacterData | null>((row as { data?: unknown }).data, null);
    if (!data) continue;
    pushSourceText(sourceParts, "character_name", data.name);
    pushSourceText(sourceParts, "character_description", data.description);
    pushSourceText(sourceParts, "character_personality", data.personality);
    pushSourceText(sourceParts, "character_scenario", data.scenario);
    const tags = readStringArray(data.tags);
    activeCharacterTags.push(...tags);
    if (tags.length > 0) pushSourceText(sourceParts, "character_tags", tags.join(", "));
  }

  if (personaId) {
    const persona = await characters.getPersona(personaId);
    if (persona) {
      pushSourceText(sourceParts, "persona_description", (persona as { description?: unknown }).description);
      const tags = readStringArray((persona as { tags?: unknown }).tags);
      if (tags.length > 0) pushSourceText(sourceParts, "persona_tags", tags.join(", "));
    }
  }

  const additionalMatchingSourceText: Partial<Record<LorebookMatchingSource, string>> = {};
  for (const [source, parts] of Object.entries(sourceParts) as Array<[LorebookMatchingSource, string[]]>) {
    additionalMatchingSourceText[source] = uniqueStrings(parts).join("\n");
  }

  return {
    activeCharacterIds,
    activeCharacterTags: uniqueStrings(activeCharacterTags),
    additionalMatchingSourceText,
  };
}

export function filterRelevantLorebooks(lorebooks: RelevantLorebook[], filters?: LorebookFilters): RelevantLorebook[] {
  const enabledBooks = lorebooks.filter((book) => book.enabled);
  if (!filters) return enabledBooks;

  const excludedLorebookIds = new Set(filters.excludedLorebookIds ?? []);
  const excludedSourceAgentIds = new Set(filters.excludedSourceAgentIds ?? []);

  return enabledBooks.filter((book) => {
    if (excludedLorebookIds.has(book.id)) return false;
    if (book.sourceAgentId && excludedSourceAgentIds.has(book.sourceAgentId)) return false;
    if (book.isGlobal) return true;
    if (filters.activeLorebookIds?.includes(book.id)) return true;
    if ((book.characterIds ?? []).some((id) => filters.characterIds?.includes(id))) return true;
    if (book.characterId && filters.characterIds?.includes(book.characterId)) return true;
    if (filters.personaId && (book.personaIds ?? []).includes(filters.personaId)) return true;
    if (book.personaId && book.personaId === filters.personaId) return true;
    if (book.chatId && book.chatId === filters.chatId) return true;
    return false;
  });
}

function toTimingStateMap(states?: Record<string, LorebookEntryTimingState>): Map<string, EntryTimingState> {
  if (!states) return new Map();
  const map = new Map<string, EntryTimingState>();
  for (const [entryId, state] of Object.entries(states)) {
    if (!state || typeof state !== "object") continue;
    map.set(entryId, {
      lastActivatedAt: typeof state.lastActivatedAt === "number" ? state.lastActivatedAt : null,
      stickyCount: Math.max(0, Number(state.stickyCount ?? 0)),
      cooldownRemaining: Math.max(0, Number(state.cooldownRemaining ?? 0)),
      delayRemaining: Math.max(0, Number(state.delayRemaining ?? 0)),
    });
  }
  return map;
}

function hasSerializedTimingStates(states?: Record<string, LorebookEntryTimingState>): boolean {
  return states !== undefined && Object.keys(states).length > 0;
}

export function serializeTimingStateMap(
  states: Map<string, EntryTimingState>,
): Record<string, LorebookEntryTimingState> {
  const record: Record<string, LorebookEntryTimingState> = {};
  for (const [entryId, state] of states) {
    record[entryId] = {
      lastActivatedAt: state.lastActivatedAt,
      stickyCount: state.stickyCount,
      cooldownRemaining: state.cooldownRemaining,
      delayRemaining: state.delayRemaining,
    };
  }
  return record;
}

export function enforceMaxActivatedEntries(
  activatedEntries: ActivatedEntry[],
  maxEntries: number = LIMITS.MAX_LOREBOOK_ENTRIES,
): ActivatedEntry[] {
  if (maxEntries <= 0 || activatedEntries.length <= maxEntries) return activatedEntries;
  return [...activatedEntries]
    .sort((a, b) => {
      if (a.entry.constant && !b.entry.constant) return -1;
      if (!a.entry.constant && b.entry.constant) return 1;
      return a.injectionOrder - b.injectionOrder;
    })
    .slice(0, maxEntries)
    .sort((a, b) => a.injectionOrder - b.injectionOrder);
}

export function applyLorebookDefaults(
  entries: LorebookEntry[],
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "scanDepth">>,
): LorebookEntry[] {
  return entries.map((entry) => {
    if (entry.scanDepth !== null && entry.scanDepth !== undefined) return entry;
    const lorebook = lorebooksById.get(entry.lorebookId);
    if (!lorebook) return entry;
    return {
      ...entry,
      scanDepth: lorebook.scanDepth,
    };
  });
}

export function applyPerLorebookTokenBudgets(
  activatedEntries: ActivatedEntry[],
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "tokenBudget">>,
): ActivatedEntry[] {
  if (activatedEntries.length === 0) return [];

  const grouped = new Map<string, ActivatedEntry[]>();
  for (const entry of activatedEntries) {
    const list = grouped.get(entry.entry.lorebookId) ?? [];
    list.push(entry);
    grouped.set(entry.entry.lorebookId, list);
  }

  const budgeted: ActivatedEntry[] = [];
  for (const [lorebookId, group] of grouped) {
    const budget = lorebooksById.get(lorebookId)?.tokenBudget ?? 0;
    budgeted.push(...applyTokenBudget(group, budget));
  }

  return budgeted.sort((a, b) => a.injectionOrder - b.injectionOrder);
}

export interface LorebookContentResolution {
  content: string;
  commit?: () => void;
  rollback?: () => void;
}

export type LorebookFinalContentResolver = (value: string) => string | LorebookContentResolution;

export function resolveActivatedLorebookEntryContent(
  activatedEntries: ActivatedEntry[],
  resolveContent?: (value: string) => string,
  options: { useRawContent?: boolean } = {},
): ActivatedEntry[] {
  if (!resolveContent) return activatedEntries;
  return activatedEntries.map((entry) => ({
    ...entry,
    rawContent: entry.rawContent ?? entry.entry.content,
    entry: {
      ...entry.entry,
      content: resolveContent(options.useRawContent ? (entry.rawContent ?? entry.entry.content) : entry.entry.content),
    },
  }));
}

function resolveFinalLorebookContent(
  activatedEntry: ActivatedEntry,
  resolveContent?: LorebookFinalContentResolver,
): LorebookContentResolution {
  const rawContent = activatedEntry.rawContent ?? activatedEntry.entry.content;
  if (!resolveContent) return { content: rawContent };
  const result = resolveContent(rawContent);
  return typeof result === "string" ? { content: result } : result;
}

function lorebookSelectionOrder(a: ActivatedEntry, b: ActivatedEntry): number {
  if (a.entry.constant && !b.entry.constant) return -1;
  if (!a.entry.constant && b.entry.constant) return 1;
  return a.injectionOrder - b.injectionOrder;
}

function lorebookInjectionOrder(a: ActivatedEntry, b: ActivatedEntry): number {
  return a.injectionOrder - b.injectionOrder;
}

// Lorebook budgets currently use the project-wide chars/4 approximation.
// This can drift for CJK, emoji, and long-tail vocabulary until a canonical tokenizer is available here.
function estimateLorebookTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

type LorebookBudgetSelectionState = {
  selected: ActivatedEntry[];
  selectedIds: Set<string>;
  perLorebookTokens: Map<string, number>;
  totalTokens: number;
};

type LorebookBudgetSkipCandidate = {
  entry: ActivatedEntry;
  estimatedTokens: number;
  lorebookBudget: number;
  lorebookUsedTokens: number;
  chatBudget: number;
  chatUsedTokens: number;
  blockedBy: LorebookBudgetSkipReason;
};

function createLorebookBudgetSelectionState(): LorebookBudgetSelectionState {
  return {
    selected: [],
    selectedIds: new Set(),
    perLorebookTokens: new Map(),
    totalTokens: 0,
  };
}

function cloneLorebookBudgetSelectionState(state: LorebookBudgetSelectionState): LorebookBudgetSelectionState {
  return {
    selected: [...state.selected],
    selectedIds: new Set(state.selectedIds),
    perLorebookTokens: new Map(state.perLorebookTokens),
    totalTokens: state.totalTokens,
  };
}

type LorebookResolutionPass = {
  entries: ActivatedEntry[];
  resolutions: LorebookContentResolution[];
};

type BudgetedLorebookEntrySelection =
  | { selected: true; entry: ActivatedEntry }
  | { selected: false; skipped?: LorebookBudgetSkipCandidate };

function resolveLorebookResolutionPass(
  candidates: ActivatedEntry[],
  resolveContent?: LorebookFinalContentResolver,
): LorebookResolutionPass {
  const entries: ActivatedEntry[] = [];
  const resolutions: LorebookContentResolution[] = [];

  for (const candidate of [...candidates].sort(lorebookInjectionOrder)) {
    const resolved = resolveFinalLorebookContent(candidate, resolveContent);
    resolutions.push(resolved);
    entries.push({
      ...candidate,
      rawContent: candidate.rawContent ?? candidate.entry.content,
      entry: {
        ...candidate.entry,
        content: resolved.content,
      },
    });
  }

  return { entries, resolutions };
}

function commitLorebookResolutionPass(pass: LorebookResolutionPass): void {
  for (const resolution of pass.resolutions) {
    resolution.commit?.();
  }
}

function rollbackLorebookResolutionPass(pass: LorebookResolutionPass): void {
  for (const resolution of [...pass.resolutions].reverse()) {
    resolution.rollback?.();
  }
}

function sameActivatedEntrySet(a: ActivatedEntry[], b: ActivatedEntry[]): boolean {
  if (a.length !== b.length) return false;
  const bIds = new Set(b.map((entry) => entry.entry.id));
  return a.every((entry) => bIds.has(entry.entry.id));
}

function getBudgetSkipReason(exceedsLorebookBudget: boolean, exceedsGlobalBudget: boolean): LorebookBudgetSkipReason {
  if (exceedsLorebookBudget && exceedsGlobalBudget) return "both";
  if (exceedsLorebookBudget) return "lorebook";
  return "chat";
}

function trySelectBudgetedLorebookEntry(
  candidate: ActivatedEntry,
  state: LorebookBudgetSelectionState,
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
): BudgetedLorebookEntrySelection {
  if (state.selectedIds.has(candidate.entry.id)) return { selected: false };
  if (maxEntries > 0 && state.selected.length >= maxEntries) return { selected: false };

  const entryTokens = estimateLorebookTokens(candidate.entry.content);
  const lorebookBudget = lorebooksById.get(candidate.entry.lorebookId)?.tokenBudget ?? 0;
  const lorebookTokens = state.perLorebookTokens.get(candidate.entry.lorebookId) ?? 0;
  const exceedsLorebookBudget = lorebookBudget > 0 && lorebookTokens + entryTokens > lorebookBudget;
  const exceedsGlobalBudget = tokenBudget > 0 && state.totalTokens + entryTokens > tokenBudget;

  if (exceedsLorebookBudget || exceedsGlobalBudget) {
    return {
      selected: false,
      skipped: {
        entry: candidate,
        estimatedTokens: entryTokens,
        lorebookBudget,
        lorebookUsedTokens: lorebookTokens,
        chatBudget: tokenBudget,
        chatUsedTokens: state.totalTokens,
        blockedBy: getBudgetSkipReason(exceedsLorebookBudget, exceedsGlobalBudget),
      },
    };
  }

  state.selected.push(candidate);
  state.selectedIds.add(candidate.entry.id);
  state.perLorebookTokens.set(candidate.entry.lorebookId, lorebookTokens + entryTokens);
  state.totalTokens += entryTokens;

  return { selected: true, entry: candidate };
}

function toBudgetSkippedEntries(
  skipped: LorebookBudgetSkipCandidate[],
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name">>,
): LorebookBudgetSkippedEntry[] {
  const seen = new Set<string>();
  const diagnostics: LorebookBudgetSkippedEntry[] = [];

  for (const skippedEntry of skipped.sort((a, b) => lorebookInjectionOrder(a.entry, b.entry))) {
    const { entry } = skippedEntry.entry;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    diagnostics.push({
      id: entry.id,
      name: entry.name,
      lorebookId: entry.lorebookId,
      lorebookName: lorebooksById.get(entry.lorebookId)?.name ?? "Unknown lorebook",
      matchedKeys: skippedEntry.entry.matchedKeys,
      estimatedTokens: skippedEntry.estimatedTokens,
      lorebookBudget: skippedEntry.lorebookBudget,
      lorebookUsedTokens: skippedEntry.lorebookUsedTokens,
      chatBudget: skippedEntry.chatBudget,
      chatUsedTokens: skippedEntry.chatUsedTokens,
      blockedBy: skippedEntry.blockedBy,
    });
  }

  return diagnostics;
}

function selectBudgetedLorebookEntryBatch(
  candidates: ActivatedEntry[],
  baseState: LorebookBudgetSelectionState,
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
  resolveContent?: LorebookFinalContentResolver,
): {
  selectedFromCandidates: ActivatedEntry[];
  state: LorebookBudgetSelectionState;
  budgetSkippedEntries: LorebookBudgetSkippedEntry[];
} {
  let pool = candidates;
  const maxPasses = Math.max(1, candidates.length + 1);
  let resolutionPasses = 0;
  let resolvedEntryCount = 0;
  let lastSkippedBudgetEntries: LorebookBudgetSkipCandidate[] = [];

  for (let passIndex = 0; passIndex < maxPasses; passIndex++) {
    const pass = resolveLorebookResolutionPass(pool, resolveContent);
    resolutionPasses += 1;
    resolvedEntryCount += pass.resolutions.length;
    const nextState = cloneLorebookBudgetSelectionState(baseState);
    const selectedFromCandidates: ActivatedEntry[] = [];
    const skippedFromCandidates: LorebookBudgetSkipCandidate[] = [];

    for (const candidate of [...pass.entries].sort(lorebookSelectionOrder)) {
      if (maxEntries > 0 && nextState.selected.length >= maxEntries) break;
      const selected = trySelectBudgetedLorebookEntry(candidate, nextState, lorebooksById, tokenBudget, maxEntries);
      if (selected.selected) {
        selectedFromCandidates.push(selected.entry);
      } else if (selected.skipped) {
        skippedFromCandidates.push(selected.skipped);
      }
    }

    selectedFromCandidates.sort(lorebookInjectionOrder);

    if (sameActivatedEntrySet(pool, selectedFromCandidates)) {
      commitLorebookResolutionPass(pass);
      return {
        selectedFromCandidates,
        state: nextState,
        budgetSkippedEntries: toBudgetSkippedEntries(lastSkippedBudgetEntries, lorebooksById),
      };
    }

    rollbackLorebookResolutionPass(pass);
    lastSkippedBudgetEntries = skippedFromCandidates;
    pool = selectedFromCandidates;
  }

  const pass = resolveLorebookResolutionPass(pool, resolveContent);
  resolutionPasses += 1;
  resolvedEntryCount += pass.resolutions.length;
  const nextState = cloneLorebookBudgetSelectionState(baseState);
  const selectedFromCandidates: ActivatedEntry[] = [];
  const skippedFromCandidates: LorebookBudgetSkipCandidate[] = [];

  for (const candidate of [...pass.entries].sort(lorebookSelectionOrder)) {
    if (maxEntries > 0 && nextState.selected.length >= maxEntries) break;
    const selected = trySelectBudgetedLorebookEntry(candidate, nextState, lorebooksById, tokenBudget, maxEntries);
    if (selected.selected) {
      selectedFromCandidates.push(selected.entry);
    } else if (selected.skipped) {
      skippedFromCandidates.push(selected.skipped);
    }
  }

  selectedFromCandidates.sort(lorebookInjectionOrder);
  if (sameActivatedEntrySet(pool, selectedFromCandidates)) {
    commitLorebookResolutionPass(pass);
    return {
      selectedFromCandidates,
      state: nextState,
      budgetSkippedEntries: toBudgetSkippedEntries(lastSkippedBudgetEntries, lorebooksById),
    };
  }

  rollbackLorebookResolutionPass(pass);
  logger.warn(
    "[lorebook] Budgeted selection failed to converge after %d passes (maxPasses=%d candidates=%d pool=%d resolved=%d); dropping batch",
    resolutionPasses,
    maxPasses,
    candidates.length,
    pool.length,
    resolvedEntryCount,
  );
  return {
    selectedFromCandidates: [],
    state: cloneLorebookBudgetSelectionState(baseState),
    budgetSkippedEntries: toBudgetSkippedEntries(lastSkippedBudgetEntries, lorebooksById),
  };
}

export function resolveAndBudgetActivatedLorebookEntriesWithDiagnostics(
  activatedEntries: ActivatedEntry[],
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
  resolveContent?: LorebookFinalContentResolver,
): { selected: ActivatedEntry[]; budgetSkippedEntries: LorebookBudgetSkippedEntry[] } {
  if (activatedEntries.length === 0) return { selected: [], budgetSkippedEntries: [] };

  const { state, budgetSkippedEntries } = selectBudgetedLorebookEntryBatch(
    activatedEntries,
    createLorebookBudgetSelectionState(),
    lorebooksById,
    tokenBudget,
    maxEntries,
    resolveContent,
  );

  return {
    selected: state.selected.sort(lorebookInjectionOrder),
    budgetSkippedEntries,
  };
}

export function resolveAndBudgetActivatedLorebookEntries(
  activatedEntries: ActivatedEntry[],
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
  resolveContent?: LorebookFinalContentResolver,
): ActivatedEntry[] {
  return resolveAndBudgetActivatedLorebookEntriesWithDiagnostics(
    activatedEntries,
    lorebooksById,
    tokenBudget,
    maxEntries,
    resolveContent,
  ).selected;
}

export function resolveBudgetAndRecursivelyActivateLorebookEntriesWithDiagnostics(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions,
  maxDepth: number,
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
  resolveContent?: LorebookFinalContentResolver,
): { selected: ActivatedEntry[]; budgetSkippedEntries: LorebookBudgetSkippedEntry[] } {
  let state = createLorebookBudgetSelectionState();
  const processedIds = new Set<string>();
  let frontier = scanForActivatedEntries(messages, entries, options);
  const budgetSkippedEntries: LorebookBudgetSkippedEntry[] = [];

  for (let depth = 0; frontier.length > 0; depth++) {
    const candidates = frontier.filter(
      (candidate) => !processedIds.has(candidate.entry.id) && !state.selectedIds.has(candidate.entry.id),
    );
    for (const candidate of candidates) {
      processedIds.add(candidate.entry.id);
    }

    const selectedBatch = selectBudgetedLorebookEntryBatch(
      candidates,
      state,
      lorebooksById,
      tokenBudget,
      maxEntries,
      resolveContent,
    );
    state = selectedBatch.state;
    budgetSkippedEntries.push(...selectedBatch.budgetSkippedEntries);

    const recursiveContentParts = selectedBatch.selectedFromCandidates
      .filter((selected) => !selected.entry.preventRecursion)
      .map((selected) => selected.entry.content);

    if (depth >= maxDepth) break;
    if (maxEntries > 0 && state.selected.length >= maxEntries) break;

    const recursiveContent = recursiveContentParts.join("\n");
    if (!recursiveContent) break;

    const remaining = entries.filter((entry) => !processedIds.has(entry.id) && !state.selectedIds.has(entry.id));
    if (remaining.length === 0) break;

    frontier = scanForActivatedEntries([{ role: "system", content: recursiveContent }], remaining, options);
  }

  return {
    selected: state.selected.sort(lorebookInjectionOrder),
    budgetSkippedEntries,
  };
}

export function resolveBudgetAndRecursivelyActivateLorebookEntries(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions,
  maxDepth: number,
  lorebooksById: ReadonlyMap<string, Pick<Lorebook, "name" | "tokenBudget">>,
  tokenBudget: number,
  maxEntries: number,
  resolveContent?: LorebookFinalContentResolver,
): ActivatedEntry[] {
  return resolveBudgetAndRecursivelyActivateLorebookEntriesWithDiagnostics(
    messages,
    entries,
    options,
    maxDepth,
    lorebooksById,
    tokenBudget,
    maxEntries,
    resolveContent,
  ).selected;
}

/**
 * Main lorebook processing for a generation request.
 * 1. Fetch all active entries from enabled lorebooks
 * 2. Scan chat messages for keyword matches
 * 3. Process into injectable blocks
 */
export async function processLorebooks(
  db: DB,
  messages: ScanMessage[],
  gameState?: GameStateForScanning | null,
  options?: {
    chatId?: string;
    characterIds?: string[];
    personaId?: string | null;
    activeLorebookIds?: string[];
    excludedLorebookIds?: string[];
    excludedSourceAgentIds?: string[];
    tokenBudget?: number;
    enableRecursive?: boolean;
    /** Pre-computed embedding of the chat context for semantic matching. */
    chatEmbedding?: number[] | null;
    /** Cosine similarity threshold for semantic matching (0-1, default 0.3). */
    semanticThreshold?: number;
    /** Per-chat entry state overrides (from chat metadata). When provided, ephemeral
     *  countdown is tracked here instead of modifying the global entry row. */
    entryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
    /** Per-chat timing state for sticky/cooldown/delay. */
    entryTimingStates?: Record<string, LorebookEntryTimingState>;
    /** Preview/debug scan: read timing state but do not return mutable timing updates. */
    previewOnly?: boolean;
    /** Generation trigger labels used by per-entry include/exclude filters. */
    generationTriggers?: string[];
    /** Resolves prompt macros for final included lorebook entries. May apply macro side effects. */
    resolveContent?: LorebookFinalContentResolver;
  },
): Promise<LorebookScanResult> {
  const storage = createLorebooksStorage(db);

  // Build filters for scoped lorebook selection.
  // When the caller provides options (even with empty arrays), scope to matching
  // lorebooks only. This prevents the "load everything" fallback when the caller
  // explicitly has no context (e.g., the prompt reviewer).
  const filters = options
    ? {
        chatId: options.chatId,
        characterIds: options.characterIds,
        personaId: options.personaId,
        activeLorebookIds: options.activeLorebookIds,
        excludedLorebookIds: options.excludedLorebookIds,
        excludedSourceAgentIds: options.excludedSourceAgentIds,
      }
    : undefined;

  const allLorebooks = (await storage.list()) as unknown as Lorebook[];
  const relevantLorebooks = filterRelevantLorebooks(allLorebooks, filters);
  const relevantLorebooksById = new Map(relevantLorebooks.map((lorebook) => [lorebook.id, lorebook]));

  // Fetch active entries (filtered if context provided)
  let allEntries = applyLorebookDefaults(
    (await storage.listActiveEntries(filters)) as unknown as LorebookEntry[],
    relevantLorebooksById,
  );

  // Apply per-chat entry state overrides — an entry that was disabled by ephemeral
  // countdown in *this* chat should be excluded, and ephemeral values should
  // reflect the per-chat remaining count rather than the global default.
  const overrides = options?.entryStateOverrides;
  if (overrides) {
    allEntries = allEntries
      .filter((e) => {
        const ov = overrides[e.id];
        // If per-chat override explicitly disabled this entry, skip it
        if (ov && ov.enabled === false) return false;
        return true;
      })
      .map((e) => {
        const ov = overrides[e.id];
        if (ov && ov.ephemeral !== undefined) {
          // Use per-chat ephemeral remaining instead of global value
          return { ...e, ephemeral: ov.ephemeral };
        }
        return e;
      });
  }

  const previewOnly = options?.previewOnly === true;

  if (allEntries.length === 0) {
    return {
      worldInfoBefore: "",
      worldInfoAfter: "",
      depthEntries: [],
      totalEntries: 0,
      totalTokensEstimate: 0,
      activatedEntryIds: [],
      activatedEntries: [],
      budgetSkippedEntries: [],
      ...(!previewOnly && hasSerializedTimingStates(options?.entryTimingStates)
        ? { updatedEntryTimingStates: {} }
        : {}),
    };
  }

  const tokenBudget = options?.tokenBudget ?? LIMITS.DEFAULT_LOREBOOK_TOKEN_BUDGET;
  const timingStates = toTimingStateMap(options?.entryTimingStates);
  const currentMessageIndex = messages.length;
  const matchingContext = await buildLorebookMatchingContext(
    db,
    options?.characterIds,
    options?.personaId ?? null,
    gameState ?? null,
  );

  // Scan for activated entries
  const scanOpts: ScanOptions = {
    scanDepth: 0, // Scan all messages
    gameState: gameState ?? null,
    chatEmbedding: options?.chatEmbedding ?? null,
    semanticThreshold: options?.semanticThreshold,
    activeCharacterIds: matchingContext.activeCharacterIds,
    activeCharacterTags: matchingContext.activeCharacterTags,
    generationTriggers: options?.generationTriggers ?? ["chat"],
    additionalMatchingSourceText: matchingContext.additionalMatchingSourceText,
    timingStates,
    currentMessageIndex,
  };

  // Determine recursion settings from relevant enabled lorebooks only.
  const anyRecursive =
    options?.enableRecursive || relevantLorebooks.some((b: { recursiveScanning: boolean }) => b.recursiveScanning);
  const maxRecursionDepth = relevantLorebooks.reduce(
    (max: number, b: { recursiveScanning: boolean; maxRecursionDepth?: number }) => {
      if (!b.recursiveScanning) return max;
      return Math.max(max, b.maxRecursionDepth ?? 3);
    },
    3,
  );

  const budgetResult = anyRecursive
    ? resolveBudgetAndRecursivelyActivateLorebookEntriesWithDiagnostics(
        messages,
        allEntries,
        scanOpts,
        maxRecursionDepth,
        relevantLorebooksById,
        tokenBudget,
        LIMITS.MAX_LOREBOOK_ENTRIES,
        options?.resolveContent,
      )
    : resolveAndBudgetActivatedLorebookEntriesWithDiagnostics(
        scanForActivatedEntries(messages, allEntries, scanOpts),
        relevantLorebooksById,
        tokenBudget,
        LIMITS.MAX_LOREBOOK_ENTRIES,
        options?.resolveContent,
      );
  const finalActivated = budgetResult.selected;

  // Decrement ephemeral counters for activated entries.
  // When per-chat overrides are provided, track the countdown in those overrides
  // so each chat has independent ephemeral state. Otherwise fall back to global
  // DB writes (legacy / test-scan behavior, but skip global writes for test scans
  // that don't pass a chatId).
  let updatedOverrides: Record<string, { ephemeral?: number | null; enabled?: boolean }> | undefined;

  if (previewOnly) {
    updatedOverrides = undefined;
  } else if (overrides) {
    // Per-chat tracking: write to overrides, leave global entry untouched
    updatedOverrides = { ...overrides };
    for (const a of finalActivated) {
      if (a.entry.ephemeral !== null && a.entry.ephemeral > 0) {
        const remaining = a.entry.ephemeral - 1;
        updatedOverrides[a.entry.id] = {
          ...updatedOverrides[a.entry.id],
          ephemeral: remaining,
          ...(remaining <= 0 ? { enabled: false } : {}),
        };
      }
    }
  } else if (options?.chatId) {
    // Legacy path: first call for this chat (no overrides yet) — initialise per-chat overrides
    updatedOverrides = {};
    for (const a of finalActivated) {
      if (a.entry.ephemeral !== null && a.entry.ephemeral > 0) {
        const remaining = a.entry.ephemeral - 1;
        updatedOverrides[a.entry.id] = {
          ephemeral: remaining,
          ...(remaining <= 0 ? { enabled: false } : {}),
        };
      }
    }
  }
  // When neither overrides nor chatId is present (e.g. test scan), do nothing —
  // don't modify global state or return overrides.

  // Process into injectable content
  const updatedTimingMap = previewOnly
    ? undefined
    : updateTimingStatesForScan(allEntries, finalActivated, timingStates, currentMessageIndex);
  const updatedEntryTimingStates =
    updatedTimingMap && (timingStates.size > 0 || updatedTimingMap.size > 0)
      ? serializeTimingStateMap(updatedTimingMap)
      : undefined;

  const result = processActivatedEntries(finalActivated, 0);

  return {
    ...result,
    activatedEntryIds: finalActivated.map((a) => a.entry.id),
    activatedEntries: finalActivated.map((a) => ({ id: a.entry.id, content: a.entry.content })),
    budgetSkippedEntries: budgetResult.budgetSkippedEntries,
    ...(updatedOverrides ? { updatedEntryStateOverrides: updatedOverrides } : {}),
    ...(updatedEntryTimingStates ? { updatedEntryTimingStates } : {}),
  };
}
