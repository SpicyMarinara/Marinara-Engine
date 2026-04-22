// ──────────────────────────────────────────────
// Game: Auto-Journal Service
//
// Builds a structured journal from committed game
// state snapshots — no LLM summarization needed.
// ──────────────────────────────────────────────

import type { GameNpc, SessionSummary, GameMap } from "@marinara-engine/shared";

// ── Types ──

export interface JournalEntry {
  timestamp: string;
  type: "location" | "npc" | "combat" | "quest" | "item" | "event" | "note";
  title: string;
  content: string;
}

export interface QuestEntry {
  id: string;
  name: string;
  status: "active" | "completed" | "failed";
  description: string;
  objectives: string[];
  discoveredAt: string;
  completedAt?: string;
}

export interface Journal {
  /** All chronological entries */
  entries: JournalEntry[];
  /** Active and completed quests */
  quests: QuestEntry[];
  /** Locations discovered */
  locations: string[];
  /** NPC interaction log */
  npcLog: Array<{ npcName: string; interactions: string[] }>;
  /** Inventory changes log */
  inventoryLog: Array<{ item: string; action: "acquired" | "used" | "lost"; quantity: number; timestamp: string }>;
}

function getReadableEntryKey(title: string, content: string): string {
  return `${title.replace(/\r\n/g, "\n").trim()}\u0000${content.replace(/\r\n/g, "\n").trim()}`;
}

// ── Builder Functions ──

/** Create an empty journal. */
export function createJournal(): Journal {
  return {
    entries: [],
    quests: [],
    locations: [],
    npcLog: [],
    inventoryLog: [],
  };
}

/** Add a location discovery to the journal. */
export function addLocationEntry(journal: Journal, location: string, description: string = ""): Journal {
  if (journal.locations.includes(location)) return journal;

  return {
    ...journal,
    locations: [...journal.locations, location],
    entries: [
      ...journal.entries,
      {
        timestamp: new Date().toISOString(),
        type: "location",
        title: `Discovered: ${location}`,
        content: description || `The party arrived at ${location}.`,
      },
    ],
  };
}

/** Add an NPC interaction to the journal. */
export function addNpcEntry(journal: Journal, npc: GameNpc, interaction: string): Journal {
  const existing = journal.npcLog.find((n) => n.npcName === npc.name);
  const updatedLog = existing
    ? journal.npcLog.map((n) => (n.npcName === npc.name ? { ...n, interactions: [...n.interactions, interaction] } : n))
    : [...journal.npcLog, { npcName: npc.name, interactions: [interaction] }];

  return {
    ...journal,
    npcLog: updatedLog,
    entries: [
      ...journal.entries,
      {
        timestamp: new Date().toISOString(),
        type: "npc",
        title: `${npc.emoji} ${npc.name}`,
        content: interaction,
      },
    ],
  };
}

/** Add a combat event to the journal. */
export function addCombatEntry(journal: Journal, description: string, outcome: "victory" | "defeat" | "fled"): Journal {
  return {
    ...journal,
    entries: [
      ...journal.entries,
      {
        timestamp: new Date().toISOString(),
        type: "combat",
        title: `Combat: ${outcome}`,
        content: description,
      },
    ],
  };
}

/** Add or update a quest in the journal. */
export function upsertQuest(
  journal: Journal,
  quest: Omit<QuestEntry, "discoveredAt"> & { discoveredAt?: string },
): Journal {
  const existing = journal.quests.find((q) => q.id === quest.id);

  if (existing) {
    const updated = journal.quests.map((q) =>
      q.id === quest.id
        ? {
            ...q,
            name: quest.name || q.name,
            status: quest.status,
            description: quest.description || q.description,
            objectives: quest.objectives.length > 0 ? quest.objectives : q.objectives,
            completedAt: quest.status === "completed" ? new Date().toISOString() : q.completedAt,
          }
        : q,
    );
    return { ...journal, quests: updated };
  }

  const newQuest: QuestEntry = {
    ...quest,
    discoveredAt: quest.discoveredAt ?? new Date().toISOString(),
  };

  return {
    ...journal,
    quests: [...journal.quests, newQuest],
    entries: [
      ...journal.entries,
      {
        timestamp: new Date().toISOString(),
        type: "quest",
        title: `Quest: ${quest.name}`,
        content: quest.description,
      },
    ],
  };
}

/** Add an inventory change. */
export function addInventoryEntry(
  journal: Journal,
  item: string,
  action: "acquired" | "used" | "lost",
  quantity: number = 1,
): Journal {
  return {
    ...journal,
    inventoryLog: [...journal.inventoryLog, { item, action, quantity, timestamp: new Date().toISOString() }],
    entries: [
      ...journal.entries,
      {
        timestamp: new Date().toISOString(),
        type: "item",
        title: `${action === "acquired" ? "Found" : action === "used" ? "Used" : "Lost"}: ${item}`,
        content: `${quantity}x ${item} ${action}.`,
      },
    ],
  };
}

/** Add a general event entry. */
export function addEventEntry(journal: Journal, title: string, content: string): Journal {
  return {
    ...journal,
    entries: [...journal.entries, { timestamp: new Date().toISOString(), type: "event", title, content }],
  };
}

/** Add a readable note or book entry (shown in the Library tab). */
export function addNoteEntry(journal: Journal, title: string, content: string): Journal {
  const seenReadableKeys = new Set<string>();
  let removedDuplicates = false;
  const dedupedEntries = journal.entries.filter((entry) => {
    if (entry.type !== "note") return true;
    const key = getReadableEntryKey(entry.title, entry.content);
    if (seenReadableKeys.has(key)) {
      removedDuplicates = true;
      return false;
    }
    seenReadableKeys.add(key);
    return true;
  });

  const nextKey = getReadableEntryKey(title, content);
  if (seenReadableKeys.has(nextKey)) {
    return removedDuplicates ? { ...journal, entries: dedupedEntries } : journal;
  }

  return {
    ...journal,
    entries: [...dedupedEntries, { timestamp: new Date().toISOString(), type: "note", title, content }],
  };
}

/**
 * Build a structured session recap from journal data.
 * This replaces the LLM-based session summary for deterministic recaps.
 */
export function buildStructuredRecap(journal: Journal, sessionNumber: number): string {
  const sections: string[] = [`Session ${sessionNumber} Recap:`];

  // Locations
  if (journal.locations.length > 0) {
    sections.push(`\nLocations visited: ${journal.locations.join(", ")}`);
  }

  // Quest progress
  const activeQuests = journal.quests.filter((q) => q.status === "active");
  const completedQuests = journal.quests.filter((q) => q.status === "completed");
  if (completedQuests.length > 0) {
    sections.push(`\nCompleted quests: ${completedQuests.map((q) => q.name).join(", ")}`);
  }
  if (activeQuests.length > 0) {
    sections.push(`\nActive quests: ${activeQuests.map((q) => q.name).join(", ")}`);
  }

  // NPC interactions
  if (journal.npcLog.length > 0) {
    sections.push("\nKey NPC interactions:");
    for (const npc of journal.npcLog) {
      const latest = npc.interactions[npc.interactions.length - 1];
      sections.push(`  - ${npc.npcName}: ${latest}`);
    }
  }

  // Combat events
  const combatEntries = journal.entries.filter((e) => e.type === "combat");
  if (combatEntries.length > 0) {
    sections.push(`\nCombat encounters: ${combatEntries.length}`);
    for (const entry of combatEntries.slice(-3)) {
      sections.push(`  - ${entry.content}`);
    }
  }

  // Notable items
  const acquiredItems = journal.inventoryLog.filter((i) => i.action === "acquired");
  if (acquiredItems.length > 0) {
    sections.push(`\nItems acquired: ${acquiredItems.map((i) => `${i.quantity}x ${i.item}`).join(", ")}`);
  }

  return sections.join("\n");
}

/**
 * Build a deterministic session summary from journal + game state.
 * Can replace the LLM-based conclude session in many cases.
 */
export function buildDeterministicSummary(
  journal: Journal,
  sessionNumber: number,
  npcs: GameNpc[],
  map: GameMap | null,
): Omit<SessionSummary, "timestamp"> {
  const combatEntries = journal.entries.filter((e) => e.type === "combat");
  const questEntries = journal.quests;
  const npcEntries = journal.npcLog;

  // Key discoveries = completed quests + new locations + key events
  const keyDiscoveries: string[] = [
    ...questEntries.filter((q) => q.status === "completed").map((q) => `Completed: ${q.name}`),
    ...journal.locations.map((l) => `Visited: ${l}`),
  ];

  // NPC updates
  const npcUpdates = npcEntries.map((n) => {
    const npc = npcs.find((np) => np.name === n.npcName);
    return `${n.npcName}: ${n.interactions.length} interactions${npc ? ` (reputation: ${npc.reputation})` : ""}`;
  });

  // Party dynamics from combat and interaction patterns
  const partyDynamics =
    combatEntries.length > 0
      ? `The party fought ${combatEntries.length} encounter(s) this session.`
      : "A peaceful session focused on exploration and dialogue.";

  return {
    sessionNumber,
    summary: buildStructuredRecap(journal, sessionNumber),
    partyDynamics,
    partyState: `${journal.locations.length} locations explored, ${questEntries.filter((q) => q.status === "active").length} active quests`,
    keyDiscoveries,
    revelations: [],
    characterMoments: [],
    statsSnapshot: {},
    npcUpdates,
  };
}
