// ──────────────────────────────────────────────
// Zustand Store: Agent Slice
// ──────────────────────────────────────────────
import { create } from "zustand";
import type { AgentResult, CharacterCardFieldUpdate } from "@marinara-engine/shared";

/**
 * A character_card_update result awaiting user confirmation.
 *
 * Character cards are sensitive (they define the character's identity) so
 * the Card Evolution Auditor never writes them automatically — each batch
 * of proposed edits sits here until the user approves or rejects it.
 */
export interface PendingCardUpdate {
  /** Client-generated ID, used as key for dismissal. */
  id: string;
  characterId: string;
  characterName: string;
  updates: CharacterCardFieldUpdate[];
  agentName: string;
  /** ms since epoch — used for stable ordering. */
  timestamp: number;
}

interface AgentState {
  activeAgents: string[];
  lastResults: Map<string, AgentResult>;
  isProcessing: boolean;
  /** Agent types that failed even after auto-retry — manual retry available */
  failedAgentTypes: string[];
  thoughtBubbles: Array<{
    agentId: string;
    agentName: string;
    content: string;
    timestamp: number;
  }>;
  echoMessages: Array<{
    characterName: string;
    reaction: string;
    timestamp: number;
  }>;
  /** How many echo messages are currently revealed (stagger counter) */
  echoVisibleCount: number;
  /** Baseline: messages at or below this count are shown without stagger */
  echoBaseline: number;
  /** Chat ID whose echo messages have been loaded — prevents redundant fetches across remounts */
  echoLoadedChatId: string | null;
  cyoaChoices: Array<{
    label: string;
    text: string;
  }>;
  pendingCardUpdates: PendingCardUpdate[];

  // Actions
  setActiveAgents: (agents: string[]) => void;
  setProcessing: (processing: boolean) => void;
  addResult: (agentId: string, result: AgentResult) => void;
  setFailedAgentTypes: (types: string[]) => void;
  clearFailedAgentTypes: () => void;
  addThoughtBubble: (agentId: string, agentName: string, content: string) => void;
  dismissThoughtBubble: (index: number) => void;
  clearThoughtBubbles: () => void;
  addEchoMessage: (characterName: string, reaction: string) => void;
  setEchoMessages: (messages: Array<{ characterName: string; reaction: string; timestamp: number }>) => void;
  clearEchoMessages: () => void;
  setEchoVisibleCount: (count: number) => void;
  setEchoBaseline: (count: number) => void;
  setEchoLoadedChatId: (chatId: string | null) => void;
  setCyoaChoices: (choices: Array<{ label: string; text: string }>) => void;
  clearCyoaChoices: () => void;
  enqueuePendingCardUpdate: (entry: PendingCardUpdate) => void;
  dismissPendingCardUpdate: (id: string) => void;
  clearPendingCardUpdates: () => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  activeAgents: [],
  lastResults: new Map(),
  isProcessing: false,
  failedAgentTypes: [],
  thoughtBubbles: [],
  echoMessages: [],
  echoVisibleCount: 0,
  echoBaseline: 0,
  echoLoadedChatId: null,
  cyoaChoices: [],
  pendingCardUpdates: [],

  setActiveAgents: (agents) => set({ activeAgents: agents }),
  setProcessing: (processing) => set({ isProcessing: processing }),

  addResult: (agentId, result) =>
    set((s) => {
      const results = new Map(s.lastResults);
      results.set(agentId, result);
      // Cap at 50 entries — evict oldest
      if (results.size > 50) {
        const first = results.keys().next().value;
        if (first !== undefined) results.delete(first);
      }
      return { lastResults: results };
    }),

  setFailedAgentTypes: (types) => set({ failedAgentTypes: types }),
  clearFailedAgentTypes: () => set({ failedAgentTypes: [] }),

  addThoughtBubble: (agentId, agentName, content) =>
    set((s) => ({
      thoughtBubbles: [...s.thoughtBubbles, { agentId, agentName, content, timestamp: Date.now() }].slice(-50),
    })),

  dismissThoughtBubble: (index) =>
    set((s) => ({
      thoughtBubbles: s.thoughtBubbles.filter((_, i) => i !== index),
    })),

  clearThoughtBubbles: () => set({ thoughtBubbles: [] }),

  addEchoMessage: (characterName, reaction) =>
    set((s) => ({
      echoMessages: [...s.echoMessages, { characterName, reaction, timestamp: Date.now() }].slice(-500),
    })),

  setEchoMessages: (messages) => set({ echoMessages: messages.slice(-500) }),

  clearEchoMessages: () => set({ echoMessages: [], echoVisibleCount: 0, echoBaseline: 0, echoLoadedChatId: null }),

  setEchoVisibleCount: (count) => set({ echoVisibleCount: count }),
  setEchoBaseline: (count) => set({ echoBaseline: count }),
  setEchoLoadedChatId: (chatId) => set({ echoLoadedChatId: chatId }),

  setCyoaChoices: (choices) => set({ cyoaChoices: choices }),
  clearCyoaChoices: () => set({ cyoaChoices: [] }),

  enqueuePendingCardUpdate: (entry) =>
    set((s) => ({ pendingCardUpdates: [...s.pendingCardUpdates, entry].slice(-20) })),
  dismissPendingCardUpdate: (id) =>
    set((s) => ({ pendingCardUpdates: s.pendingCardUpdates.filter((e) => e.id !== id) })),
  clearPendingCardUpdates: () => set({ pendingCardUpdates: [] }),

  reset: () =>
    set({
      activeAgents: [],
      lastResults: new Map(),
      isProcessing: false,
      failedAgentTypes: [],
      thoughtBubbles: [],
      echoMessages: [],
      echoVisibleCount: 0,
      echoBaseline: 0,
      echoLoadedChatId: null,
      cyoaChoices: [],
      pendingCardUpdates: [],
    }),
}));
