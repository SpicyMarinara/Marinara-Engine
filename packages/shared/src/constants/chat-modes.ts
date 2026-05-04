// ──────────────────────────────────────────────
// Chat Mode Definitions
// ──────────────────────────────────────────────
import type { ChatMode } from "../types/chat.js";

export interface ChatModeDefinition {
  id: ChatMode;
  name: string;
  description: string;
  icon: string;
  /** Which agents are enabled by default for this mode */
  defaultAgents: string[];
}

export const CHAT_MODES: Record<ChatMode, ChatModeDefinition> = {
  conversation: {
    id: "conversation",
    name: "Conversation",
    description: "A straightforward AI conversation — no roleplay elements.",
    icon: "💬",
    defaultAgents: ["schedule-planner", "response-orchestrator", "autonomous-messenger"],
  },
  roleplay: {
    id: "roleplay",
    name: "Roleplay",
    description: "Immersive roleplay with characters, game state tracking, and world simulation.",
    icon: "🎭",
    defaultAgents: ["world-state", "prose-guardian", "continuity", "expression"],
  },
  visual_novel: {
    id: "visual_novel",
    name: "Visual Novel",
    description: "Visual novel experience with backgrounds, sprites, text boxes, and choices.",
    icon: "🎮",
    defaultAgents: ["world-state", "prose-guardian", "expression"],
  },
  game: {
    id: "game",
    name: "Game",
    description: "AI-managed singleplayer RPG with a Game Master, party members, sessions, and dice.",
    icon: "🎲",
    defaultAgents: ["world-state", "quest", "expression", "combat"],
  },
};
