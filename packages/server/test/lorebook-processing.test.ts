import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  DEFAULT_GENERATION_PARAMS,
  resolveMacros,
  type Lorebook,
  type LorebookEntry,
  type MacroContext,
} from "@marinara-engine/shared";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { lorebookEntries, lorebooks } from "../src/db/schema/index.js";
import {
  applyLorebookDefaults,
  applyPerLorebookTokenBudgets,
  enforceMaxActivatedEntries,
  filterRelevantLorebooks,
  resolveAndBudgetActivatedLorebookEntries,
  resolveActivatedLorebookEntryContent,
  resolveBudgetAndRecursivelyActivateLorebookEntries,
  serializeTimingStateMap,
} from "../src/services/lorebook/index.js";
import { processActivatedEntries } from "../src/services/lorebook/prompt-injector.js";
import {
  scanForActivatedEntries,
  updateTimingStatesForScan,
  type ActivatedEntry,
} from "../src/services/lorebook/keyword-scanner.js";
import { assemblePrompt } from "../src/services/prompt/assembler.js";

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
    characterIds: [],
    personaId: null,
    personaIds: [],
    chatId: null,
    isGlobal: false,
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

function snapshotMacroVariables(variables: MacroContext["variables"]): MacroContext["variables"] {
  // Macro variables are string-only, so a shallow clone is a complete rollback snapshot.
  return { ...variables };
}

function dbLorebookEntry(id: string, overrides: Partial<ReturnType<typeof lorebookEntryRow>> = {}) {
  return {
    ...lorebookEntryRow(id),
    ...overrides,
  };
}

function lorebookEntryRow(id: string) {
  return {
    id,
    lorebookId: "book-1",
    folderId: null,
    name: id,
    content: "Lore entry",
    description: "",
    keys: JSON.stringify(["marker-key"]),
    secondaryKeys: "[]",
    enabled: "true",
    constant: "false",
    selective: "false",
    selectiveLogic: "and" as const,
    probability: null,
    scanDepth: null,
    matchWholeWords: "false",
    caseSensitive: "false",
    useRegex: "false",
    characterFilterMode: "any" as const,
    characterFilterIds: "[]",
    characterTagFilterMode: "any" as const,
    characterTagFilters: "[]",
    generationTriggerFilterMode: "any" as const,
    generationTriggerFilters: "[]",
    additionalMatchingSources: "[]",
    position: 0,
    depth: 4,
    order: 100,
    role: "system" as const,
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    locked: "false",
    tag: "",
    relationships: "{}",
    dynamicState: "{}",
    activationConditions: "[]",
    schedule: null,
    preventRecursion: "false",
    embedding: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("macro-expanded lorebook content is budgeted and estimated after expansion", () => {
  const expandedContent = tokenContent(20);
  const activated = resolveActivatedLorebookEntryContent(
    [{ entry: makeEntry({ content: "{{description}}" }), matchedKeys: ["keyword"], injectionOrder: 100 }],
    (value) => value.replace("{{description}}", expandedContent),
  );
  const budgetedOut = applyPerLorebookTokenBudgets(activated, new Map([["book-1", makeLorebook({ tokenBudget: 5 })]]));
  const processed = processActivatedEntries(activated, 0);

  assert.deepEqual(budgetedOut, []);
  assert.equal(processed.worldInfoBefore, expandedContent);
  assert.equal(processed.totalTokensEstimate, 20);
});

test("depth 0 lorebook entries are included for depth injection", () => {
  const activated: ActivatedEntry[] = [
    {
      entry: makeEntry({
        content: "Depth zero lore",
        position: 2,
        depth: 0,
        role: "system",
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 100,
    },
  ];

  const processed = processActivatedEntries(activated, 0);

  assert.deepEqual(processed.depthEntries, [
    {
      content: "Depth zero lore",
      role: "system",
      depth: 0,
      order: 100,
    },
  ]);
});

test("lorebook final budgets use resolved variable macro content and roll back skipped side effects", () => {
  const longPayload = tokenContent(20);
  const macroContext: MacroContext = {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables: {},
  };
  const resolveActual = (value: string) => {
    const before = snapshotMacroVariables(macroContext.variables);
    const content = resolveMacros(value, macroContext, { trimResult: false });
    let settled = false;
    return {
      content,
      commit: () => {
        settled = true;
      },
      rollback: () => {
        if (settled) return;
        macroContext.variables = before;
        settled = true;
      },
    };
  };
  const resolveIsolated = (value: string) =>
    resolveMacros(
      value,
      {
        ...macroContext,
        variables: { ...macroContext.variables },
      },
      { trimResult: false },
    );
  const activated: ActivatedEntry[] = [
    {
      entry: makeEntry({
        id: "setter",
        content: `{{setvar::payload::${longPayload}}}`,
        order: 100,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 100,
    },
    {
      entry: makeEntry({
        id: "reader",
        content: "{{getvar::payload}}",
        order: 200,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 200,
    },
  ];

  const previewResolved = resolveActivatedLorebookEntryContent(activated, resolveIsolated);
  assert.equal(macroContext.variables.payload, undefined);
  assert.equal(previewResolved[1]?.entry.content, "");
  const selected = resolveAndBudgetActivatedLorebookEntries(
    previewResolved,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    5,
    10,
    resolveActual,
  );

  assert.deepEqual(
    selected.map((entry) => entry.entry.id),
    ["setter"],
  );
  assert.equal(macroContext.variables.payload, longPayload);
  assert.equal(selected[0]?.entry.content, "");
});

test("lorebook macro side effects resolve in final injection order", () => {
  const macroContext: MacroContext = {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables: {},
  };
  const resolveActual = (value: string) => {
    const before = snapshotMacroVariables(macroContext.variables);
    const content = resolveMacros(value, macroContext, { trimResult: false });
    let settled = false;
    return {
      content,
      commit: () => {
        settled = true;
      },
      rollback: () => {
        if (settled) return;
        macroContext.variables = before;
        settled = true;
      },
    };
  };
  const activated: ActivatedEntry[] = [
    {
      entry: makeEntry({
        id: "reader",
        constant: true,
        content: "Reader sees {{getvar::tone}}",
        order: 20,
      }),
      matchedKeys: ["[constant]"],
      injectionOrder: 20,
    },
    {
      entry: makeEntry({
        id: "setter",
        content: "{{setvar::tone::scarlet}}",
        order: 10,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 10,
    },
  ];

  const selected = resolveAndBudgetActivatedLorebookEntries(
    activated,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    100,
    10,
    resolveActual,
  );

  assert.deepEqual(
    selected.map((entry) => entry.entry.id),
    ["setter", "reader"],
  );
  assert.equal(selected[1]?.entry.content, "Reader sees scarlet");
  assert.equal(macroContext.variables.tone, "scarlet");
});

test("constant lorebook entries keep selection priority while macros resolve in injection order", () => {
  const macroContext: MacroContext = {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables: {},
  };
  const resolveActual = (value: string) => {
    const before = snapshotMacroVariables(macroContext.variables);
    const content = resolveMacros(value, macroContext, { trimResult: false });
    let settled = false;
    return {
      content,
      commit: () => {
        settled = true;
      },
      rollback: () => {
        if (settled) return;
        macroContext.variables = before;
        settled = true;
      },
    };
  };
  const activated: ActivatedEntry[] = [
    {
      entry: makeEntry({
        id: "setter",
        content: "{{setvar::tone::scarlet}}",
        order: 10,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 10,
    },
    {
      entry: makeEntry({
        id: "reader",
        constant: true,
        content: "Reader sees {{getvar::tone}}",
        order: 20,
      }),
      matchedKeys: ["[constant]"],
      injectionOrder: 20,
    },
    {
      entry: makeEntry({
        id: "extra",
        content: "Extra keyword lore",
        order: 30,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 30,
    },
  ];

  const selected = resolveAndBudgetActivatedLorebookEntries(
    activated,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    100,
    2,
    resolveActual,
  );

  assert.deepEqual(
    selected.map((entry) => entry.entry.id),
    ["setter", "reader"],
  );
  assert.equal(selected[1]?.entry.content, "Reader sees scarlet");
  assert.equal(macroContext.variables.tone, "scarlet");
});

test("macro-aware lorebook max-entry selection keeps constants before lower-order keywords", () => {
  const activated: ActivatedEntry[] = [
    {
      entry: makeEntry({
        id: "keyword",
        content: "Keyword lore",
        order: 10,
      }),
      matchedKeys: ["keyword"],
      injectionOrder: 10,
    },
    {
      entry: makeEntry({
        id: "constant",
        constant: true,
        content: "Constant lore",
        order: 20,
      }),
      matchedKeys: ["[constant]"],
      injectionOrder: 20,
    },
  ];

  const selected = resolveAndBudgetActivatedLorebookEntries(
    activated,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    100,
    1,
  );

  assert.deepEqual(
    selected.map((entry) => entry.entry.id),
    ["constant"],
  );
});

test("recursive lorebook scans use macro-expanded activated entry content", () => {
  const activated = resolveBudgetAndRecursivelyActivateLorebookEntries(
    [{ role: "user", content: "first-key" }],
    [
      makeEntry({ id: "entry-a", keys: ["first-key"], content: "{{description}}" }),
      makeEntry({ id: "entry-b", keys: ["nested-key"], content: "Nested lore" }),
    ],
    {},
    3,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    100,
    10,
    (value) => value.replace("{{description}}", "nested-key"),
  );

  assert.deepEqual(
    activated.map((entry) => entry.entry.id),
    ["entry-a", "entry-b"],
  );
  assert.equal(activated[0]?.entry.content, "nested-key");
});

test("recursive lorebook scans reuse the selected final macro content", () => {
  let randomMacroResolutions = 0;
  const activated = resolveBudgetAndRecursivelyActivateLorebookEntries(
    [{ role: "user", content: "first-key" }],
    [
      makeEntry({ id: "entry-a", keys: ["first-key"], content: "{{random::dragon::castle}}", order: 100 }),
      makeEntry({ id: "entry-b", keys: ["dragon"], content: "Dragon lore", order: 200 }),
      makeEntry({ id: "entry-c", keys: ["castle"], content: "Castle lore", order: 300 }),
    ],
    {},
    3,
    new Map([["book-1", makeLorebook({ tokenBudget: 100 })]]),
    100,
    10,
    (value) => {
      if (value !== "{{random::dragon::castle}}") return value;
      randomMacroResolutions++;
      return {
        content: randomMacroResolutions === 1 ? "dragon" : "castle",
        commit: () => {},
        rollback: () => {},
      };
    },
  );

  assert.deepEqual(
    activated.map((entry) => entry.entry.id),
    ["entry-a", "entry-b"],
  );
  assert.equal(activated[0]?.entry.content, "dragon");
  assert.equal(randomMacroResolutions, 1);
});

test("multiple lorebook markers share one macro side-effect pass per prompt assembly", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(lorebooks).values({
      id: "book-1",
      name: "World Info",
      description: "",
      category: "world",
      scanDepth: 2,
      tokenBudget: 2048,
      recursiveScanning: "false",
      maxRecursionDepth: 3,
      characterId: null,
      personaId: null,
      chatId: null,
      isGlobal: "true",
      enabled: "true",
      tags: "[]",
      generatedBy: null,
      sourceAgentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(lorebookEntries).values([
      dbLorebookEntry("before-entry", {
        content: "Before {{incvar::markerSmoke}}{{getvar::markerSmoke}}",
        position: 0,
        order: 10,
      }),
      dbLorebookEntry("after-entry", {
        content: "After {{incvar::markerSmoke}}{{getvar::markerSmoke}}",
        position: 1,
        order: 20,
      }),
    ]);

    const result = await assemblePrompt({
      db,
      preset: {
        id: "preset-1",
        name: "Preset",
        sectionOrder: JSON.stringify(["before-section", "after-section"]),
        groupOrder: "[]",
        wrapFormat: "none",
        parameters: JSON.stringify(DEFAULT_GENERATION_PARAMS),
        variableGroups: "[]",
        variableValues: "{}",
      },
      sections: [
        {
          id: "before-section",
          presetId: "preset-1",
          identifier: "before",
          name: "Before",
          content: "",
          role: "system",
          enabled: "true",
          isMarker: "true",
          groupId: null,
          markerConfig: JSON.stringify({ type: "world_info_before" }),
          injectionPosition: "ordered",
          injectionDepth: 0,
          injectionOrder: 0,
          forbidOverrides: "false",
        },
        {
          id: "after-section",
          presetId: "preset-1",
          identifier: "after",
          name: "After",
          content: "",
          role: "system",
          enabled: "true",
          isMarker: "true",
          groupId: null,
          markerConfig: JSON.stringify({ type: "world_info_after" }),
          injectionPosition: "ordered",
          injectionDepth: 0,
          injectionOrder: 1,
          forbidOverrides: "false",
        },
      ],
      groups: [],
      choiceBlocks: [],
      chatChoices: {},
      chatId: "chat-1",
      characterIds: [],
      personaName: "User",
      personaDescription: "",
      chatMessages: [{ role: "user", content: "marker-key" }],
      activeLorebookIds: [],
    });

    const content = result.messages.map((message) => message.content).join("\n");
    assert.match(content, /Before 1/);
    assert.match(content, /After 2/);
    assert.doesNotMatch(content, /After 4/);
  } finally {
    client.close();
  }
});

test("assembler can scan guide-only lorebook text without adding it to chat history", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(lorebooks).values({
      id: "book-1",
      name: "World Info",
      description: "",
      category: "world",
      scanDepth: 2,
      tokenBudget: 2048,
      recursiveScanning: "false",
      maxRecursionDepth: 3,
      characterId: null,
      personaId: null,
      chatId: null,
      isGlobal: "true",
      enabled: "true",
      tags: "[]",
      generatedBy: null,
      sourceAgentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(lorebookEntries).values(
      dbLorebookEntry("guide-entry", {
        content: "Guide-only lore",
        keys: JSON.stringify(["guide-key"]),
        position: 0,
        order: 10,
      }),
    );

    const result = await assemblePrompt({
      db,
      preset: {
        id: "preset-1",
        name: "Preset",
        sectionOrder: JSON.stringify(["lorebook-section", "history-section"]),
        groupOrder: "[]",
        wrapFormat: "none",
        parameters: JSON.stringify(DEFAULT_GENERATION_PARAMS),
        variableGroups: "[]",
        variableValues: "{}",
      },
      sections: [
        {
          id: "lorebook-section",
          presetId: "preset-1",
          identifier: "lorebook",
          name: "Lorebook",
          content: "",
          role: "system",
          enabled: "true",
          isMarker: "true",
          groupId: null,
          markerConfig: JSON.stringify({ type: "world_info_before" }),
          injectionPosition: "ordered",
          injectionDepth: 0,
          injectionOrder: 0,
          forbidOverrides: "false",
        },
        {
          id: "history-section",
          presetId: "preset-1",
          identifier: "history",
          name: "History",
          content: "",
          role: "user",
          enabled: "true",
          isMarker: "true",
          groupId: null,
          markerConfig: JSON.stringify({ type: "chat_history" }),
          injectionPosition: "ordered",
          injectionDepth: 0,
          injectionOrder: 1,
          forbidOverrides: "false",
        },
      ],
      groups: [],
      choiceBlocks: [],
      chatChoices: {},
      chatId: "chat-1",
      characterIds: [],
      personaName: "User",
      personaDescription: "",
      chatMessages: [{ role: "user", content: "ordinary visible message" }],
      lorebookScanMessages: [
        { role: "user", content: "ordinary visible message" },
        { role: "user", content: "guide-key hidden instruction" },
      ],
      activeLorebookIds: [],
    });

    const content = result.messages.map((message) => message.content).join("\n");
    assert.match(content, /Guide-only lore/);
    assert.match(content, /ordinary visible message/);
    assert.doesNotMatch(content, /guide-key hidden instruction/);
  } finally {
    client.close();
  }
});

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

test("entry probability is rolled only after a trigger candidate matches", () => {
  let rolls = 0;
  const entry = makeEntry({ probability: 1 });

  const untriggered = scanForActivatedEntries([{ role: "user", content: "nothing relevant" }], [entry], {
    random: () => {
      rolls++;
      return 0;
    },
  });

  assert.equal(untriggered.length, 0);
  assert.equal(rolls, 0);

  const blocked = scanForActivatedEntries([{ role: "user", content: "keyword" }], [entry], {
    random: () => {
      rolls++;
      return 0.99;
    },
  });

  assert.equal(blocked.length, 0);
  assert.equal(rolls, 1);
});

test("entry probability is not re-rolled by semantic fallback after a keyword match fails the roll", () => {
  let rolls = 0;
  const entry = makeEntry({ probability: 1, embedding: [1, 0] });

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [entry], {
    chatEmbedding: [1, 0],
    semanticThreshold: 0.5,
    random: () => {
      rolls++;
      return rolls === 1 ? 0.99 : 0;
    },
  });

  assert.equal(activated.length, 0);
  assert.equal(rolls, 1);
});

test("entry probability allows activation when the roll is below the configured percentage", () => {
  const entry = makeEntry({ probability: 1 });

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [entry], {
    random: () => 0.009,
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

test("multi-linked lorebooks activate for any linked character or persona", () => {
  const multiCharacterBook = makeLorebook({
    id: "multi-character-book",
    characterId: "legacy-char",
    characterIds: ["character-2", "character-3"],
  });
  const multiPersonaBook = makeLorebook({
    id: "multi-persona-book",
    personaId: "legacy-persona",
    personaIds: ["persona-2", "persona-3"],
  });
  const unrelatedBook = makeLorebook({
    id: "unrelated-book",
    characterIds: ["character-x"],
    personaIds: ["persona-x"],
  });

  const relevant = filterRelevantLorebooks([multiCharacterBook, multiPersonaBook, unrelatedBook], {
    characterIds: ["character-3"],
    personaId: "persona-2",
    activeLorebookIds: [],
  });

  assert.deepEqual(
    relevant.map((book) => book.id),
    ["multi-character-book", "multi-persona-book"],
  );
});

test("global lorebooks bypass other scope filters when enabled", () => {
  const globalBook = makeLorebook({ id: "global-book", isGlobal: true });
  const inactiveGlobalBook = makeLorebook({ id: "disabled-global-book", isGlobal: true, enabled: false });
  const otherPersonaBook = makeLorebook({ id: "other-persona-book", personaId: "persona-2" });

  const relevant = filterRelevantLorebooks([globalBook, inactiveGlobalBook, otherPersonaBook], {
    characterIds: [],
    personaId: "persona-1",
    activeLorebookIds: [],
    chatId: "chat-1",
  });

  assert.deepEqual(
    relevant.map((book) => book.id),
    ["global-book"],
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

test("max activated lorebook entries keeps highest-priority entries", () => {
  const activatedEntries: ActivatedEntry[] = [
    { entry: makeEntry({ id: "late", order: 30 }), matchedKeys: ["keyword"], injectionOrder: 30 },
    {
      entry: makeEntry({ id: "constant", constant: true, order: 40 }),
      matchedKeys: ["[constant]"],
      injectionOrder: 40,
    },
    { entry: makeEntry({ id: "early", order: 10 }), matchedKeys: ["keyword"], injectionOrder: 10 },
  ];

  const capped = enforceMaxActivatedEntries(activatedEntries, 2);

  assert.deepEqual(
    capped.map((entry) => entry.entry.id),
    ["early", "constant"],
  );
});

test("timing state persists delay, cooldown, and sticky activation windows", () => {
  const entry = makeEntry({ sticky: 1, cooldown: 2, delay: 1 });
  const delayed = scanForActivatedEntries([{ role: "user", content: "keyword" }], [entry], {
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 1,
        },
      ],
    ]),
    currentMessageIndex: 1,
  });
  assert.equal(delayed.length, 0);

  const afterDelay = updateTimingStatesForScan(
    [entry],
    delayed,
    new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 1,
        },
      ],
    ]),
    1,
  );
  assert.equal(afterDelay.get(entry.id)?.delayRemaining, 0);

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [entry], {
    timingStates: afterDelay,
    currentMessageIndex: 2,
  });
  assert.deepEqual(
    activated.map((result) => result.entry.id),
    [entry.id],
  );

  const afterActivation = updateTimingStatesForScan([entry], activated, afterDelay, 2);
  assert.equal(afterActivation.get(entry.id)?.stickyCount, 1);
  assert.equal(afterActivation.get(entry.id)?.cooldownRemaining, 2);

  const sticky = scanForActivatedEntries([{ role: "user", content: "no match" }], [entry], {
    timingStates: afterActivation,
    currentMessageIndex: 3,
  });
  assert.deepEqual(
    sticky.map((result) => result.matchedKeys[0]),
    ["[sticky]"],
  );

  const afterSticky = updateTimingStatesForScan([entry], sticky, afterActivation, 3);
  assert.equal(afterSticky.get(entry.id)?.stickyCount, 0);
});

test("timing state clears when sticky-only and cooldown-only windows expire", () => {
  const stickyEntry = makeEntry({ id: "sticky", keys: ["sticky-key"], sticky: 1 });
  const cooldownEntry = makeEntry({ id: "cooldown", keys: ["cooldown-key"], cooldown: 1 });

  const afterStickyActivation = updateTimingStatesForScan(
    [stickyEntry],
    [{ entry: stickyEntry, matchedKeys: ["sticky-key"], injectionOrder: stickyEntry.order }],
    new Map(),
    1,
  );
  assert.equal(afterStickyActivation.get(stickyEntry.id)?.stickyCount, 1);

  const sticky = scanForActivatedEntries([{ role: "user", content: "no match" }], [stickyEntry], {
    timingStates: afterStickyActivation,
    currentMessageIndex: 2,
  });
  assert.deepEqual(
    sticky.map((result) => result.matchedKeys[0]),
    ["[sticky]"],
  );
  const afterStickyExpires = updateTimingStatesForScan([stickyEntry], sticky, afterStickyActivation, 2);
  assert.deepEqual(Array.from(afterStickyExpires.entries()), []);
  assert.deepEqual(serializeTimingStateMap(afterStickyExpires), {});

  const afterCooldownActivation = updateTimingStatesForScan(
    [cooldownEntry],
    [{ entry: cooldownEntry, matchedKeys: ["cooldown-key"], injectionOrder: cooldownEntry.order }],
    new Map(),
    1,
  );
  assert.equal(afterCooldownActivation.get(cooldownEntry.id)?.cooldownRemaining, 1);

  const blocked = scanForActivatedEntries([{ role: "user", content: "cooldown-key" }], [cooldownEntry], {
    timingStates: afterCooldownActivation,
    currentMessageIndex: 2,
  });
  assert.deepEqual(blocked, []);
  const afterCooldownExpires = updateTimingStatesForScan([cooldownEntry], blocked, afterCooldownActivation, 2);
  assert.deepEqual(Array.from(afterCooldownExpires.entries()), []);
  assert.deepEqual(serializeTimingStateMap(afterCooldownExpires), {});
});

test("preview scans ignore mutable timing state without sticky activations", () => {
  const delayed = makeEntry({ id: "delayed", delay: 2, order: 10 });
  const coolingDown = makeEntry({ id: "cooldown", cooldown: 3, order: 20 });
  const sticky = makeEntry({ id: "sticky", sticky: 2, order: 30 });

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [delayed, coolingDown, sticky], {
    ignoreTiming: true,
    timingStates: new Map([
      [delayed.id, { lastActivatedAt: null, stickyCount: 0, cooldownRemaining: 0, delayRemaining: 2 }],
      [coolingDown.id, { lastActivatedAt: 1, stickyCount: 0, cooldownRemaining: 3, delayRemaining: 0 }],
      [sticky.id, { lastActivatedAt: 1, stickyCount: 2, cooldownRemaining: 0, delayRemaining: 0 }],
    ]),
  });

  assert.deepEqual(
    activated.map((result) => result.entry.id),
    ["delayed", "cooldown", "sticky"],
  );
  assert.deepEqual(
    activated.map((result) => result.matchedKeys[0]),
    ["keyword", "keyword", "keyword"],
  );

  const noKeywordActivated = scanForActivatedEntries([{ role: "user", content: "no match" }], [sticky], {
    ignoreTiming: true,
    timingStates: new Map([
      [sticky.id, { lastActivatedAt: 1, stickyCount: 2, cooldownRemaining: 0, delayRemaining: 0 }],
    ]),
  });

  assert.deepEqual(noKeywordActivated, []);
});

test("preview-style scans honor supplied timing state without forcing activation", () => {
  const delayed = makeEntry({ id: "delayed", delay: 2, order: 10 });
  const coolingDown = makeEntry({ id: "cooldown", cooldown: 3, order: 20 });
  const sticky = makeEntry({ id: "sticky", sticky: 2, order: 30 });
  const timingStates = new Map([
    [delayed.id, { lastActivatedAt: null, stickyCount: 0, cooldownRemaining: 0, delayRemaining: 2 }],
    [coolingDown.id, { lastActivatedAt: 1, stickyCount: 0, cooldownRemaining: 3, delayRemaining: 0 }],
    [sticky.id, { lastActivatedAt: 1, stickyCount: 2, cooldownRemaining: 0, delayRemaining: 0 }],
  ]);

  const activated = scanForActivatedEntries([{ role: "user", content: "keyword" }], [delayed, coolingDown, sticky], {
    timingStates,
  });

  assert.deepEqual(
    activated.map((result) => result.entry.id),
    ["sticky"],
  );
  assert.deepEqual(
    activated.map((result) => result.matchedKeys[0]),
    ["[sticky]"],
  );
});

test("sticky activations still obey game-state conditions and schedules", () => {
  const entry = makeEntry({
    sticky: 2,
    activationConditions: [{ field: "location", operator: "equals", value: "forest" }],
    schedule: { activeTimes: ["night"], activeDates: [], activeLocations: [] },
  });
  const timingStates = new Map([
    [
      entry.id,
      {
        lastActivatedAt: 1,
        stickyCount: 2,
        cooldownRemaining: 0,
        delayRemaining: 0,
      },
    ],
  ]);

  const wrongLocation = scanForActivatedEntries([{ role: "user", content: "no match" }], [entry], {
    gameState: { location: "city", time: "night" },
    timingStates,
  });
  assert.deepEqual(wrongLocation, []);

  const wrongSchedule = scanForActivatedEntries([{ role: "user", content: "no match" }], [entry], {
    gameState: { location: "forest", time: "morning" },
    timingStates,
  });
  assert.deepEqual(wrongSchedule, []);

  const activated = scanForActivatedEntries([{ role: "user", content: "no match" }], [entry], {
    gameState: { location: "forest", time: "night" },
    timingStates,
  });
  assert.deepEqual(
    activated.map((result) => result.matchedKeys[0]),
    ["[sticky]"],
  );
});

test("constant entries obey delay and activation conditions", () => {
  const entry = makeEntry({
    constant: true,
    delay: 1,
    activationConditions: [{ field: "location", operator: "equals", value: "forest" }],
  });
  const waiting = scanForActivatedEntries([{ role: "user", content: "" }], [entry], {
    gameState: { location: "forest" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 1,
        },
      ],
    ]),
  });
  assert.deepEqual(waiting, []);

  const wrongLocation = scanForActivatedEntries([{ role: "user", content: "" }], [entry], {
    gameState: { location: "city" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 0,
        },
      ],
    ]),
  });
  assert.deepEqual(wrongLocation, []);

  const activated = scanForActivatedEntries([{ role: "user", content: "" }], [entry], {
    gameState: { location: "forest" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 0,
        },
      ],
    ]),
  });
  assert.deepEqual(
    activated.map((result) => result.matchedKeys[0]),
    ["[constant]"],
  );
});

test("semantic fallback obeys timing, conditions, and schedule", () => {
  const entry = makeEntry({
    id: "semantic-entry",
    keys: ["no-keyword-match"],
    embedding: [1, 0],
    delay: 1,
    activationConditions: [{ field: "location", operator: "equals", value: "forest" }],
    schedule: { activeTimes: ["night"], activeDates: [], activeLocations: [] },
  });
  const blocked = scanForActivatedEntries([{ role: "user", content: "ordinary chat" }], [entry], {
    chatEmbedding: [1, 0],
    semanticThreshold: 0.9,
    gameState: { location: "forest", time: "night" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 1,
        },
      ],
    ]),
  });
  assert.deepEqual(blocked, []);

  const wrongSchedule = scanForActivatedEntries([{ role: "user", content: "ordinary chat" }], [entry], {
    chatEmbedding: [1, 0],
    semanticThreshold: 0.9,
    gameState: { location: "forest", time: "morning" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 0,
        },
      ],
    ]),
  });
  assert.deepEqual(wrongSchedule, []);

  const activated = scanForActivatedEntries([{ role: "user", content: "ordinary chat" }], [entry], {
    chatEmbedding: [1, 0],
    semanticThreshold: 0.9,
    gameState: { location: "forest", time: "night" },
    timingStates: new Map([
      [
        entry.id,
        {
          lastActivatedAt: null,
          stickyCount: 0,
          cooldownRemaining: 0,
          delayRemaining: 0,
        },
      ],
    ]),
  });

  assert.deepEqual(
    activated.map((result) => result.entry.id),
    ["semantic-entry"],
  );
  assert.ok(activated[0]?.matchedKeys[0]?.startsWith("[semantic:"));
});
