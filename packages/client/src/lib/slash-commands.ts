// ──────────────────────────────────────────────
// Slash Commands — SillyTavern-style / commands
// ──────────────────────────────────────────────
import { api } from "./api-client";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import { toast } from "sonner";
import { SUPPORTED_MACROS, type SceneCreateResponse, type ScenePlanResponse } from "@marinara-engine/shared";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  /** If true, command is executed locally and doesn't send to the LLM */
  local?: boolean;
  /** Execute the command. Returns a string result, or null if it dispatches an action elsewhere. */
  execute: (args: string, ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

export interface SlashCommandContext {
  chatId: string;
  /** Trigger an LLM generation (with optional user message) */
  generate: (params: {
    chatId: string;
    connectionId: string | null;
    userMessage?: string;
    impersonate?: boolean;
    attachments?: { type: string; data: string }[];
  }) => Promise<boolean | void>;
  /** Insert a message directly into the chat (no LLM) */
  createMessage: (data: { role: string; content: string; characterId?: string | null }) => void;
  /** Invalidate chat queries to refresh the UI */
  invalidate: () => void;
  /** Character names in the current chat */
  characterNames: string[];
}

export interface SlashCommandResult {
  /** If true, don't send to the LLM / don't do normal send */
  handled: boolean;
  /** Optional feedback to show (ephemeral, not persisted) */
  feedback?: string;
}

// ── Dice roller ────────────────

function parseDice(notation: string): { count: number; sides: number; modifier: number } | null {
  const match = notation.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  return {
    count: parseInt(match[1] || "1", 10),
    sides: parseInt(match[2]!, 10),
    modifier: match[3] ? parseInt(match[3], 10) : 0,
  };
}

function rollDice(count: number, sides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }
  return results;
}

// ── Reminder parser ────────────────

function parseReminder(input: string): { ms: number; timeStr: string; message: string } | null {
  const match = input.match(/^((?:\d+[hms])+)\s+(.+)$/is);
  if (!match) return null;

  const timeRaw = match[1]!;
  const message = match[2]!.trim();
  if (!message) return null;

  let ms = 0;
  const h = timeRaw.match(/(\d+)h/i);
  const m = timeRaw.match(/(\d+)m/i);
  const s = timeRaw.match(/(\d+)s/i);
  if (h) ms += parseInt(h[1]!, 10) * 3_600_000;
  if (m) ms += parseInt(m[1]!, 10) * 60_000;
  if (s) ms += parseInt(s[1]!, 10) * 1_000;
  if (ms === 0) return null;

  const parts: string[] = [];
  if (h) parts.push(`${h[1]}h`);
  if (m) parts.push(`${m[1]}m`);
  if (s) parts.push(`${s[1]}s`);

  return { ms, timeStr: parts.join(""), message };
}

function buildMacroHelpText(): string {
  const sections = new Map<string, string[]>();

  for (const macro of SUPPORTED_MACROS) {
    const lines = sections.get(macro.category) ?? [];
    lines.push(`  ${macro.syntax} — ${macro.description}`);
    sections.set(macro.category, lines);
  }

  return [
    "Supported Macros:",
    "Tip: In group chats, a bracketed block containing character macros like {{char}} and {{description}} repeats once per character.",
    ...Array.from(sections.entries()).flatMap(([category, lines], index) =>
      index === 0 ? ["", `${category}:`, ...lines] : ["", `${category}:`, ...lines],
    ),
  ].join("\n");
}

const MACRO_HELP_TEXT = buildMacroHelpText();

// ── Command definitions ────────────────

const COMMANDS: SlashCommand[] = [
  {
    name: "roll",
    aliases: ["r", "dice"],
    description: "Roll dice (e.g. 2d6, 1d20+5)",
    usage: "/roll <notation>",
    local: true,
    async execute(args, ctx) {
      const notation = args.trim() || "1d20";
      const parsed = parseDice(notation);
      if (!parsed) return { handled: true, feedback: `Invalid dice notation: ${notation}` };
      const rolls = rollDice(parsed.count, parsed.sides);
      const sum = rolls.reduce((a, b) => a + b, 0) + parsed.modifier;
      const modStr = parsed.modifier > 0 ? `+${parsed.modifier}` : parsed.modifier < 0 ? `${parsed.modifier}` : "";
      const detail = parsed.count > 1 ? ` [${rolls.join(", ")}]${modStr}` : modStr ? ` (${rolls[0]}${modStr})` : "";
      const text = `🎲 **${notation}** → **${sum}**${detail}`;
      ctx.createMessage({ role: "narrator", content: text });
      return { handled: true };
    },
  },
  {
    name: "sys",
    aliases: ["system"],
    description: "Insert a system message",
    usage: "/sys <message>",
    local: true,
    async execute(args, ctx) {
      if (!args.trim()) return { handled: true, feedback: "Usage: /sys <message text>" };
      ctx.createMessage({ role: "system", content: args.trim() });
      return { handled: true };
    },
  },
  {
    name: "narrator",
    aliases: ["narrate", "nar"],
    description: "Steer the narrative — the AI will narrate events in the direction you describe",
    usage: "/narrator <direction>",
    async execute(args, ctx) {
      if (!args.trim()) return { handled: true, feedback: "Usage: /narrator <direction to steer the narrative>" };
      await ctx.generate({
        chatId: ctx.chatId,
        connectionId: null,
        userMessage: `[Narrator instruction — do not include a reply from {{user}}. Instead, write the next part of the narrative steering it toward the following: ${args.trim()}]`,
      });
      return { handled: true };
    },
  },
  {
    name: "continue",
    aliases: ["cont"],
    description: "Continue the AI response without sending a message",
    usage: "/continue",
    async execute(_args, ctx) {
      await ctx.generate({ chatId: ctx.chatId, connectionId: null });
      return { handled: true };
    },
  },
  {
    name: "as",
    aliases: ["respond"],
    description: "Generate a response as a specific character",
    usage: "/as <character name>",
    async execute(args, ctx) {
      const name = args.trim();
      if (!name) return { handled: true, feedback: "Usage: /as <character name>" };
      const match = ctx.characterNames.find((n) => n.toLowerCase() === name.toLowerCase());
      if (!match) {
        return {
          handled: true,
          feedback: `Character "${name}" not found. Available: ${ctx.characterNames.join(", ")}`,
        };
      }
      // Inject instruction to respond as the specific character
      await ctx.generate({
        chatId: ctx.chatId,
        connectionId: null,
        userMessage: `[Respond as ${match}]`,
      });
      return { handled: true };
    },
  },
  {
    name: "impersonate",
    aliases: ["imp"],
    description: "Generate a response as your character ({{user}}), optionally with a direction",
    usage: "/impersonate [direction]",
    async execute(args, ctx) {
      const direction = args.trim();
      await ctx.generate({
        chatId: ctx.chatId,
        connectionId: null,
        impersonate: true,
        ...(direction ? { userMessage: direction } : {}),
      });
      return { handled: true };
    },
  },
  {
    name: "remind",
    aliases: ["reminder", "timer"],
    description: "Set a timed reminder — the AI will message you after the specified time",
    usage: "/remind <time> <message>  (e.g. /remind 30m hang up laundry)",
    local: true,
    async execute(args, ctx) {
      const parsed = parseReminder(args.trim());
      if (!parsed) {
        return {
          handled: true,
          feedback:
            "Usage: /remind <time> <message>\nExamples: /remind 30m hang up laundry, /remind 1h30m check the oven",
        };
      }

      const { ms, timeStr, message } = parsed;
      const chatId = ctx.chatId;
      const invalidate = ctx.invalidate;

      setTimeout(async () => {
        try {
          await api.post(`/chats/${chatId}/messages`, {
            role: "narrator",
            content: `⏰ **Reminder:** ${message}`,
          });
          try {
            invalidate();
          } catch {
            /* component may have unmounted */
          }
        } catch {
          /* chat may have been deleted */
        }
        toast("⏰ Reminder!", { description: message, duration: 30_000 });
      }, ms);

      return {
        handled: true,
        feedback: `⏰ Reminder set for ${timeStr} from now: "${message}"\n(Keep this tab open — the reminder lives in your browser session.)`,
      };
    },
  },
  {
    name: "random",
    aliases: ["rand", "event"],
    description: "Introduce a random event to shake up the plot",
    usage: "/random",
    async execute(_args, ctx) {
      await ctx.generate({
        chatId: ctx.chatId,
        connectionId: null,
        userMessage:
          "[Narrator instruction — do not include a reply from {{user}}. Instead: And now, something completely different. Introduce a random, unexpected event to stir up the plot. Be creative and surprising — throw a curveball that keeps things interesting!]",
      });
      return { handled: true };
    },
  },
  {
    name: "scene",
    aliases: ["rp"],
    description: "Start a roleplay scene branching from this conversation",
    usage: "/scene [description]",
    local: true,
    async execute(args, ctx) {
      const prompt = args.trim();

      // If no prompt and no messages, guide the user
      if (!prompt) {
        const msgs = await api.get<unknown[]>(`/chats/${ctx.chatId}/messages`);
        if (!msgs || msgs.length === 0) {
          return {
            handled: true,
            feedback:
              "No conversation history to base a scene on. Provide a description or chat first: /scene <description>",
          };
        }
      }

      // Step 1: Ask the LLM to plan the scene (comprehensive plan)
      const planToastId = toast.loading("Planning scene...", { icon: "🎬" });
      let planRes: ScenePlanResponse;
      try {
        planRes = await api.post<ScenePlanResponse>("/scene/plan", {
          chatId: ctx.chatId,
          prompt,
          connectionId: null,
        });
      } catch {
        toast.dismiss(planToastId);
        return { handled: true, feedback: "Failed to plan scene. Check your API connection." };
      }

      if (!planRes.plan) {
        toast.dismiss(planToastId);
        return { handled: true, feedback: planRes.error || "Scene planning returned empty result. Try again." };
      }

      // Step 2: Create the scene chat using the full plan
      toast.loading("Creating scene...", { id: planToastId, icon: "🎬" });
      try {
        const res = await api.post<SceneCreateResponse>("/scene/create", {
          originChatId: ctx.chatId,
          initiatorCharId: null, // user-initiated
          plan: planRes.plan,
          connectionId: null,
        });

        // Invalidate chats so the new scene appears + navigate to it
        ctx.invalidate();
        useChatStore.getState().setActiveChatId(res.chatId);

        // Apply background if the plan chose one
        if (res.background) {
          useUIStore.getState().setChatBackground(`/api/backgrounds/file/${encodeURIComponent(res.background)}`);
        }

        toast.success(`Scene created: ${res.chatName}`, { id: planToastId, icon: "🎬" });
        return { handled: true };
      } catch {
        toast.dismiss(planToastId);
        return { handled: true, feedback: "Failed to create scene chat." };
      }
    },
  },
  {
    name: "goto",
    aliases: ["jump", "scroll"],
    description: "Scroll to a specific message number (e.g. /goto 27)",
    usage: "/goto <number>",
    local: true,
    async execute(args, ctx) {
      const raw = args.trim();
      const n = Number.parseInt(raw, 10);
      if (!raw || !Number.isFinite(n) || n < 1 || String(n) !== raw) {
        return { handled: true, feedback: "Usage: /goto <positive message number> (e.g. /goto 27)" };
      }
      useChatStore.getState().requestGotoMessage(ctx.chatId, n);
      return { handled: true };
    },
  },
  {
    name: "help",
    description: "Show available slash commands",
    usage: "/help",
    local: true,
    async execute(_args, _ctx) {
      const lines = COMMANDS.map((c) => `${c.usage} — ${c.description}`);
      return { handled: true, feedback: `Available Commands:\n${lines.join("\n")}` };
    },
  },
  {
    name: "macros",
    aliases: ["macro"],
    description: "List supported prompt macros like {{user}} and {{char}}",
    usage: "/macros",
    local: true,
    async execute() {
      return { handled: true, feedback: MACRO_HELP_TEXT };
    },
  },
];

/** Find a matching command for the given input. */
export function matchSlashCommand(input: string): { command: SlashCommand; args: string } | null {
  if (!input.startsWith("/")) return null;
  const spaceIdx = input.indexOf(" ");
  const cmdName = (spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  for (const cmd of COMMANDS) {
    if (cmd.name === cmdName || cmd.aliases?.includes(cmdName)) {
      return { command: cmd, args };
    }
  }
  return null;
}

/** Get all commands that match a partial prefix (for autocomplete). */
export function getSlashCompletions(partial: string): SlashCommand[] {
  if (!partial.startsWith("/")) return [];
  const prefix = partial.slice(1).toLowerCase();
  if (!prefix) return COMMANDS;
  return COMMANDS.filter((c) => c.name.startsWith(prefix) || c.aliases?.some((a) => a.startsWith(prefix)));
}

export { COMMANDS as SLASH_COMMANDS };
