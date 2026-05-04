import test from "node:test";
import assert from "node:assert/strict";
import type { Lorebook, LorebookEntry } from "@marinara-engine/shared";
import {
  applyLorebookDefaults,
  applyPerLorebookTokenBudgets,
  filterRelevantLorebooks,
} from "../src/services/lorebook/index.js";
import { scanForActivatedEntries, type ActivatedEntry } from "../src/services/lorebook/keyword-scanner.js";

function makeLorebook(overrides: Partial<Lorebook> = {}): Lorebook {
  return {
    id: "book-1",
    name: "Lorebook",
    description: "",
    category: "world",
    scanDepth: 2,
    tokenBudget: 2048,
    recursiveScanning: false,
    maxRecursionDepth: 3,
    characterId: null,
    personaId: null,
    chatId: null,
    enabled: true,
    tags: [],
    generatedBy: null,
    sourceAgentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: "entry-1",
    lorebookId: "book-1",
    name: "Entry",
    content: "Lore entry",
    description: "",
    keys: ["keyword"],
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
    ...overrides,
  };
}

function tokenContent(tokens: number): string {
  return "x".repeat(tokens * 4);
}

test("entries inherit their lorebook scan depth when no per-entry override is set", () => {
  const entry = makeEntry();
  const entries = applyLorebookDefaults([entry], new Map([["book-1", makeLorebook({ scanDepth: 2 })]]));

  const activated = scanForActivatedEntries(
    [
      { role: "user", content: "keyword from long ago" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "latest turn without it" },
    ],
    entries,
  );

  assert.equal(activated.length, 0);
  assert.equal(entries[0]?.scanDepth, 2);
});

test("entry character filters include and exclude active characters", () => {
  const includeEntry = makeEntry({ id: "include", characterFilterMode: "include", characterFilterIds: ["char-a"] });
  const excludeEntry = makeEntry({ id: "exclude", characterFilterMode: "exclude", characterFilterIds: ["char-b"] });

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [includeEntry, excludeEntry], {
    activeCharacterIds: ["char-a"],
  });

  assert.deepEqual(
    activated.map((entry) => entry.entry.id),
    ["include", "exclude"],
  );

  const blocked = scanForActivatedEntries([{ role: "user", content: "keyword" }], [includeEntry, excludeEntry], {
    activeCharacterIds: ["char-b"],
  });

  assert.deepEqual(
    blocked.map((entry) => entry.entry.id),
    [],
  );
});

test("additional matching sources can activate entries without chat keyword matches", () => {
  const entry = makeEntry({ additionalMatchingSources: ["character_description"], keys: ["sorcerer"] });

  const activated = scanForActivatedEntries([{ role: "user", content: "What can they do?" }], [entry], {
    additionalMatchingSourceText: {
      character_description: "A traveling Sorcerer from the northern academy.",
    },
  });

  assert.deepEqual(
    activated.map((result) => result.entry.id),
    ["entry-1"],
  );
});

test("persona-linked lorebooks activate only for the active persona", () => {
  const personaBook = makeLorebook({ id: "persona-book", personaId: "persona-1" });
  const otherPersonaBook = makeLorebook({ id: "other-persona-book", personaId: "persona-2" });
  const characterBook = makeLorebook({ id: "character-book", characterId: "character-1" });

  const relevant = filterRelevantLorebooks([personaBook, otherPersonaBook, characterBook], {
    characterIds: [],
    personaId: "persona-1",
    activeLorebookIds: [],
  });

  assert.deepEqual(
    relevant.map((book) => book.id),
    ["persona-book"],
  );
});

test("per-entry scan depth overrides the lorebook default", () => {
  const entry = makeEntry({ scanDepth: 0 });
  const entries = applyLorebookDefaults([entry], new Map([["book-1", makeLorebook({ scanDepth: 2 })]]));

  const activated = scanForActivatedEntries(
    [
      { role: "user", content: "keyword from long ago" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "latest turn without it" },
    ],
    entries,
  );

  assert.equal(activated.length, 1);
  assert.equal(entries[0]?.scanDepth, 0);
});

test("token budgets are enforced independently per lorebook", () => {
  const activatedEntries: ActivatedEntry[] = [
    {
      entry: makeEntry({ id: "a-1", lorebookId: "book-a", order: 10, content: tokenContent(120) }),
      matchedKeys: ["a"],
      injectionOrder: 10,
    },
    {
      entry: makeEntry({ id: "a-2", lorebookId: "book-a", order: 20, content: tokenContent(90) }),
      matchedKeys: ["a"],
      injectionOrder: 20,
    },
    {
      entry: makeEntry({ id: "b-1", lorebookId: "book-b", order: 5, content: tokenContent(80) }),
      matchedKeys: ["b"],
      injectionOrder: 5,
    },
    {
      entry: makeEntry({ id: "b-2", lorebookId: "book-b", order: 15, content: tokenContent(60) }),
      matchedKeys: ["b"],
      injectionOrder: 15,
    },
  ];

  const budgeted = applyPerLorebookTokenBudgets(
    activatedEntries,
    new Map([
      ["book-a", makeLorebook({ id: "book-a", tokenBudget: 200 })],
      ["book-b", makeLorebook({ id: "book-b", tokenBudget: 150 })],
    ]),
  );

  assert.deepEqual(
    budgeted.map((entry) => entry.entry.id),
    ["b-1", "a-1", "b-2"],
  );
});
