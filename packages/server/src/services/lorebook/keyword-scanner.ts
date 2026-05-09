// ──────────────────────────────────────────────
// Lorebook: Keyword Scanner
// Scans chat messages against lorebook entry keys
// and returns activated entries respecting all
// matching rules (regex, whole-word, case, selective).
// ──────────────────────────────────────────────
import type {
  ActivationCondition,
  LorebookEntry,
  LorebookFilterMode,
  LorebookMatchingSource,
  LorebookSchedule,
  SelectiveLogic,
} from "@marinara-engine/shared";

/** Compute cosine similarity between two vectors. Returns 0 for empty/mismatched vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Minimal message shape needed for scanning. */
export interface ScanMessage {
  role: string;
  content: string;
}

/** Result of scanning: an activated entry plus metadata. */
export interface ActivatedEntry {
  entry: LorebookEntry;
  /** Which key(s) matched */
  matchedKeys: string[];
  /** Priority order for injection */
  injectionOrder: number;
  /** True when sticky state kept this entry active without a fresh keyword match */
  sticky?: boolean;
}

/** Runtime state for timing (sticky/cooldown/delay). */
export interface EntryTimingState {
  /** Message index when this entry was last activated */
  lastActivatedAt: number | null;
  /** How many consecutive messages it's been active (for sticky) */
  stickyCount: number;
  /** Messages since last activation (for cooldown) */
  cooldownRemaining: number;
  /** Delay messages remaining before first activation */
  delayRemaining: number;
}

type LorebookFilterValueContext = {
  activeCharacterIds: Set<string>;
  activeCharacterTags: Set<string>;
  generationTriggers: Set<string>;
};

/** Game state fields used for condition evaluation. */
export interface GameStateForScanning {
  location?: string | null;
  time?: string | null;
  date?: string | null;
  weather?: string | null;
  temperature?: string | null;
  presentCharacters?: Array<{ name: string; characterId: string }>;
  [key: string]: unknown;
}

/**
 * Test if a single keyword matches the given text.
 */
function testKeyword(
  keyword: string,
  text: string,
  options: { useRegex: boolean; matchWholeWords: boolean; caseSensitive: boolean },
): boolean {
  if (!keyword) return false;

  try {
    if (options.useRegex) {
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(keyword, flags);
      return regex.test(text);
    }

    const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
    const haystack = options.caseSensitive ? text : text.toLowerCase();

    if (options.matchWholeWords) {
      // Word boundary matching
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = options.caseSensitive ? "g" : "gi";
      const regex = new RegExp(`\\b${escaped}\\b`, flags);
      return regex.test(text);
    }

    return haystack.includes(needle);
  } catch {
    // Invalid regex — fall back to plain text
    const needle = options.caseSensitive ? keyword : keyword.toLowerCase();
    const haystack = options.caseSensitive ? text : text.toLowerCase();
    return haystack.includes(needle);
  }
}

/**
 * Test if primary keys match the text.
 */
function testPrimaryKeys(
  keys: string[],
  text: string,
  options: { useRegex: boolean; matchWholeWords: boolean; caseSensitive: boolean },
): { matched: boolean; matchedKeys: string[] } {
  const matchedKeys: string[] = [];
  for (const key of keys) {
    if (testKeyword(key, text, options)) {
      matchedKeys.push(key);
    }
  }
  return { matched: matchedKeys.length > 0, matchedKeys };
}

/**
 * Test secondary keys with selective logic.
 */
function testSecondaryKeys(
  secondaryKeys: string[],
  text: string,
  logic: SelectiveLogic,
  options: { useRegex: boolean; matchWholeWords: boolean; caseSensitive: boolean },
): boolean {
  if (secondaryKeys.length === 0) return true;

  const results = secondaryKeys.map((key) => testKeyword(key, text, options));

  switch (logic) {
    case "and":
      return results.every(Boolean);
    case "or":
      return results.some(Boolean);
    case "not":
      return !results.some(Boolean);
    default:
      return true;
  }
}

/**
 * Evaluate activation conditions against game state.
 */
export function evaluateConditions(conditions: ActivationCondition[], gameState: GameStateForScanning | null): boolean {
  if (conditions.length === 0) return true;
  if (!gameState) return true; // No game state = conditions pass (permissive)

  for (const condition of conditions) {
    const fieldValue = String(gameState[condition.field] ?? "");

    switch (condition.operator) {
      case "equals":
        if (fieldValue.toLowerCase() !== condition.value.toLowerCase()) return false;
        break;
      case "not_equals":
        if (fieldValue.toLowerCase() === condition.value.toLowerCase()) return false;
        break;
      case "contains":
        if (!fieldValue.toLowerCase().includes(condition.value.toLowerCase())) return false;
        break;
      case "not_contains":
        if (fieldValue.toLowerCase().includes(condition.value.toLowerCase())) return false;
        break;
      case "gt":
        if (parseFloat(fieldValue) <= parseFloat(condition.value)) return false;
        break;
      case "lt":
        if (parseFloat(fieldValue) >= parseFloat(condition.value)) return false;
        break;
    }
  }

  return true;
}

/**
 * Evaluate schedule conditions against game state.
 */
function evaluateSchedule(schedule: LorebookSchedule | null, gameState: GameStateForScanning | null): boolean {
  if (!schedule) return true;
  if (!gameState) return true;

  // Check active times
  if (schedule.activeTimes.length > 0 && gameState.time) {
    const currentTime = String(gameState.time).toLowerCase();
    const matches = schedule.activeTimes.some((t) => currentTime.includes(t.toLowerCase()));
    if (!matches) return false;
  }

  // Check active dates
  if (schedule.activeDates.length > 0 && gameState.date) {
    const currentDate = String(gameState.date).toLowerCase();
    const matches = schedule.activeDates.some((d) => currentDate.includes(d.toLowerCase()));
    if (!matches) return false;
  }

  // Check active locations
  if (schedule.activeLocations.length > 0 && gameState.location) {
    const currentLoc = String(gameState.location).toLowerCase();
    const matches = schedule.activeLocations.some((l) => currentLoc.includes(l.toLowerCase()));
    if (!matches) return false;
  }

  return true;
}

/**
 * Check timing state (sticky/cooldown/delay).
 */
function checkTiming(
  entry: LorebookEntry,
  timingState: EntryTimingState | undefined,
): boolean {
  if (!timingState) return !(entry.delay !== null && entry.delay > 0);

  // Delay: must wait N messages before first activation
  if (entry.delay !== null && entry.delay > 0) {
    if (timingState.delayRemaining > 0) return false;
  }

  // Cooldown: wait N messages between activations
  if (entry.cooldown !== null && entry.cooldown > 0) {
    if (timingState.cooldownRemaining > 0) return false;
  }

  return true;
}

function passesContextualActivationGate(
  entry: LorebookEntry,
  filterContext: LorebookFilterValueContext,
  gameState: GameStateForScanning | null,
): boolean {
  if (!entry.enabled) return false;
  if (!passesEntryFilters(entry, filterContext)) return false;
  if (!evaluateConditions(entry.activationConditions, gameState)) return false;
  if (!evaluateSchedule(entry.schedule, gameState)) return false;
  return true;
}

function passesActivationGate(
  entry: LorebookEntry,
  timingState: EntryTimingState | undefined,
  filterContext: LorebookFilterValueContext,
  gameState: GameStateForScanning | null,
  ignoreTiming: boolean = false,
): boolean {
  if (!passesContextualActivationGate(entry, filterContext, gameState)) return false;
  if (!ignoreTiming && !checkTiming(entry, timingState)) return false;
  if (entry.probability !== null && entry.probability < 100) {
    if (Math.random() * 100 >= entry.probability) return false;
  }
  return true;
}

function hasTimingConfig(entry: LorebookEntry): boolean {
  return (
    (entry.sticky !== null && entry.sticky > 0) ||
    (entry.cooldown !== null && entry.cooldown > 0) ||
    (entry.delay !== null && entry.delay > 0)
  );
}

function cloneTimingState(state: EntryTimingState): EntryTimingState {
  return {
    lastActivatedAt: state.lastActivatedAt,
    stickyCount: state.stickyCount,
    cooldownRemaining: state.cooldownRemaining,
    delayRemaining: state.delayRemaining,
  };
}

function shouldPersistTimingState(entry: LorebookEntry, state: EntryTimingState): boolean {
  if (state.stickyCount > 0 || state.cooldownRemaining > 0 || state.delayRemaining > 0) return true;
  if (entry.delay !== null && entry.delay > 0) return true;
  return false;
}

export function updateTimingStatesForScan(
  entries: LorebookEntry[],
  activatedEntries: ActivatedEntry[],
  previousStates: Map<string, EntryTimingState> = new Map(),
  currentMessageIndex: number,
): Map<string, EntryTimingState> {
  const nextStates = new Map<string, EntryTimingState>();
  const activatedById = new Map(activatedEntries.map((entry) => [entry.entry.id, entry]));

  for (const entry of entries) {
    if (!hasTimingConfig(entry)) continue;
    const previous = previousStates.get(entry.id);
    const state: EntryTimingState = previous
      ? cloneTimingState(previous)
      : {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: entry.delay !== null && entry.delay > 0 ? entry.delay : 0,
        };

    const activated = activatedById.get(entry.id);
    if (activated && !activated.sticky) {
      state.lastActivatedAt = currentMessageIndex;
      state.stickyCount = entry.sticky !== null && entry.sticky > 0 ? entry.sticky : 0;
      state.cooldownRemaining = entry.cooldown !== null && entry.cooldown > 0 ? entry.cooldown : 0;
      state.delayRemaining = 0;
    } else {
      if (state.delayRemaining > 0) state.delayRemaining -= 1;
      if (state.cooldownRemaining > 0) state.cooldownRemaining -= 1;
      if (state.stickyCount > 0) state.stickyCount -= 1;
    }

    if (shouldPersistTimingState(entry, state)) {
      nextStates.set(entry.id, state);
    }
  }

  return nextStates;
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function makeValueSet(values: string[] | undefined) {
  return new Set((values ?? []).map(normalizeFilterValue).filter(Boolean));
}

function passesValueFilter(
  mode: LorebookFilterMode | undefined,
  filters: string[] | undefined,
  activeValues: Set<string>,
) {
  const normalizedMode = mode ?? "any";
  const filterValues = makeValueSet(filters);
  if (normalizedMode === "any" || filterValues.size === 0) return true;
  const hasMatch = Array.from(filterValues).some((value) => activeValues.has(value));
  return normalizedMode === "include" ? hasMatch : !hasMatch;
}

function passesEntryFilters(entry: LorebookEntry, context: LorebookFilterValueContext) {
  return (
    passesValueFilter(entry.characterFilterMode, entry.characterFilterIds, context.activeCharacterIds) &&
    passesValueFilter(entry.characterTagFilterMode, entry.characterTagFilters, context.activeCharacterTags) &&
    passesValueFilter(entry.generationTriggerFilterMode, entry.generationTriggerFilters, context.generationTriggers)
  );
}

export function lorebookEntryPassesContextFilters(
  entry: LorebookEntry,
  options: { activeCharacterIds?: string[]; activeCharacterTags?: string[]; generationTriggers?: string[] },
) {
  return passesEntryFilters(entry, {
    activeCharacterIds: makeValueSet(options.activeCharacterIds),
    activeCharacterTags: makeValueSet(options.activeCharacterTags),
    generationTriggers: makeValueSet(options.generationTriggers?.length ? options.generationTriggers : ["chat"]),
  });
}

function getAdditionalMatchingText(entry: LorebookEntry, sourceText: Partial<Record<LorebookMatchingSource, string>>) {
  if (!entry.additionalMatchingSources?.length) return "";
  return entry.additionalMatchingSources
    .map((source) => sourceText[source]?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Group-based selection: within a group, only activate entries up to weight limits.
 */
function applyGroupSelection(entries: ActivatedEntry[]): ActivatedEntry[] {
  const grouped = new Map<string, ActivatedEntry[]>();
  const ungrouped: ActivatedEntry[] = [];

  for (const entry of entries) {
    const group = entry.entry.group;
    if (group) {
      const list = grouped.get(group) ?? [];
      list.push(entry);
      grouped.set(group, list);
    } else {
      ungrouped.push(entry);
    }
  }

  const result: ActivatedEntry[] = [...ungrouped];

  for (const [, groupEntries] of grouped) {
    // Sort by weight (higher = more likely), then by order
    groupEntries.sort((a, b) => {
      const wA = a.entry.groupWeight ?? 100;
      const wB = b.entry.groupWeight ?? 100;
      if (wA !== wB) return wB - wA;
      return a.entry.order - b.entry.order;
    });
    // Pick the highest-weight entry from each group
    const top = groupEntries[0];
    if (top) {
      result.push(top);
    }
  }

  return result;
}

export interface ScanOptions {
  /** How many messages back to scan (0 = all). */
  scanDepth?: number;
  /** Current game state for condition evaluation. */
  gameState?: GameStateForScanning | null;
  /** Timing state map (entryId → state). */
  timingStates?: Map<string, EntryTimingState>;
  /** Current message index for timing calculations. */
  currentMessageIndex?: number;
  /** Pre-computed embedding of the chat context for semantic matching fallback. */
  chatEmbedding?: number[] | null;
  /** Cosine similarity threshold for semantic matching (0-1, default 0.3). */
  semanticThreshold?: number;
  /** Active character IDs for per-entry include/exclude gates. */
  activeCharacterIds?: string[];
  /** Tags from active character cards for per-entry include/exclude gates. */
  activeCharacterTags?: string[];
  /** Generation trigger names for per-entry include/exclude gates. */
  generationTriggers?: string[];
  /** Extra source text entries may opt into scanning. */
  additionalMatchingSourceText?: Partial<Record<LorebookMatchingSource, string>>;
  /** Ignore sticky/cooldown/delay runtime state for preview/debug scans. */
  ignoreTiming?: boolean;
}

/**
 * Main scanning function: given messages and lorebook entries,
 * returns the list of activated entries.
 */
export function scanForActivatedEntries(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions = {},
): ActivatedEntry[] {
  const {
    scanDepth = 0,
    gameState = null,
    timingStates = new Map(),
    currentMessageIndex = messages.length,
    chatEmbedding = null,
    semanticThreshold = 0.3,
    activeCharacterIds = [],
    activeCharacterTags = [],
    generationTriggers = ["chat"],
    additionalMatchingSourceText = {},
    ignoreTiming = false,
  } = options;
  const filterContext: LorebookFilterValueContext = {
    activeCharacterIds: makeValueSet(activeCharacterIds),
    activeCharacterTags: makeValueSet(activeCharacterTags),
    generationTriggers: makeValueSet(generationTriggers.length > 0 ? generationTriggers : ["chat"]),
  };

  // Build the text to scan from recent messages
  const messagesToScan = scanDepth > 0 ? messages.slice(-scanDepth) : messages;
  const combinedText = messagesToScan.map((m) => m.content).join("\n");

  const activated: ActivatedEntry[] = [];
  const activatedIds = new Set<string>();

  for (const entry of entries) {
    const timingState = timingStates.get(entry.id);

    if (!ignoreTiming && timingState?.stickyCount && timingState.stickyCount > 0) {
      if (!passesContextualActivationGate(entry, filterContext, gameState)) continue;
      activated.push({
        entry,
        matchedKeys: ["[sticky]"],
        injectionOrder: entry.order,
        sticky: true,
      });
      activatedIds.add(entry.id);
      continue;
    }

    if (!passesActivationGate(entry, timingState, filterContext, gameState, ignoreTiming)) continue;

    // Constant entries still activate without keywords, but they obey timing,
    // context filters, activation conditions, schedule, and probability gates.
    if (entry.constant) {
      activated.push({
        entry,
        matchedKeys: ["[constant]"],
        injectionOrder: entry.order,
      });
      activatedIds.add(entry.id);
      continue;
    }

    // Per-entry scan depth override
    const baseEntryScanText =
      entry.scanDepth !== null && entry.scanDepth > 0
        ? messages
            .slice(-entry.scanDepth)
            .map((m) => m.content)
            .join("\n")
        : combinedText;
    const extraMatchingText = getAdditionalMatchingText(entry, additionalMatchingSourceText);
    const entryScanText = extraMatchingText ? `${baseEntryScanText}\n${extraMatchingText}` : baseEntryScanText;

    const matchOptions = {
      useRegex: entry.useRegex,
      matchWholeWords: entry.matchWholeWords,
      caseSensitive: entry.caseSensitive,
    };

    // Test primary keys
    const { matched, matchedKeys } = testPrimaryKeys(entry.keys, entryScanText, matchOptions);
    if (!matched) continue;

    // Test secondary keys (selective mode)
    if (entry.selective && entry.secondaryKeys.length > 0) {
      if (!testSecondaryKeys(entry.secondaryKeys, entryScanText, entry.selectiveLogic, matchOptions)) {
        continue;
      }
    }

    activated.push({
      entry,
      matchedKeys,
      injectionOrder: entry.order,
    });
    activatedIds.add(entry.id);
  }

  // ── Semantic fallback: check entries with embeddings that weren't keyword-matched ──
  if (chatEmbedding && chatEmbedding.length > 0) {
    for (const entry of entries) {
      if (!entry.enabled || entry.constant || activatedIds.has(entry.id)) continue;
      if (!entry.embedding || entry.embedding.length === 0) continue;
      const timingState = timingStates.get(entry.id);
      if (!passesActivationGate(entry, timingState, filterContext, gameState, ignoreTiming)) continue;

      const similarity = cosineSimilarity(chatEmbedding, entry.embedding);
      if (similarity >= semanticThreshold) {
        activated.push({
          entry,
          matchedKeys: [`[semantic:${similarity.toFixed(3)}]`],
          injectionOrder: entry.order,
        });
        activatedIds.add(entry.id);
      }
    }
  }

  // Apply group selection
  const afterGroups = applyGroupSelection(activated);

  // Sort by injection order (lower = higher priority)
  afterGroups.sort((a, b) => a.injectionOrder - b.injectionOrder);

  return afterGroups;
}

/**
 * Recursive scanning: re-scan activated entry content for additional matches.
 */
export function recursiveScan(
  messages: ScanMessage[],
  entries: LorebookEntry[],
  options: ScanOptions = {},
  maxDepth: number = 3,
): ActivatedEntry[] {
  let allActivated = scanForActivatedEntries(messages, entries, options);
  const activatedIds = new Set(allActivated.map((a) => a.entry.id));

  for (let depth = 0; depth < maxDepth; depth++) {
    // Build text from newly activated entries, excluding those with preventRecursion
    const newContent = allActivated
      .filter((a) => (!activatedIds.has(a.entry.id) || depth === 0) && !a.entry.preventRecursion)
      .map((a) => a.entry.content)
      .join("\n");

    if (!newContent) break;

    // Scan remaining entries against the content of activated entries
    const remaining = entries.filter((e) => !activatedIds.has(e.id));
    const newMessages: ScanMessage[] = [{ role: "system", content: newContent }];
    const newActivated = scanForActivatedEntries(newMessages, remaining, options);

    if (newActivated.length === 0) break;

    for (const a of newActivated) {
      activatedIds.add(a.entry.id);
      allActivated.push(a);
    }
  }

  return allActivated;
}
