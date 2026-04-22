// ──────────────────────────────────────────────
// Game: Party Player Prompt Building
// ──────────────────────────────────────────────

import type { PartyArc } from "@marinara-engine/shared";
import type { CharacterSpriteInfo } from "./sprite.service.js";

export interface PartyPromptContext {
  /** Character cards for each party member, optionally enriched with game-specific class/ability info. */
  partyCards: Array<{ name: string; card: string }>;
  /** The player's name */
  playerName: string;
  /** Current state (exploration, dialogue, etc.) */
  gameActiveState: string;
  /** Personal arcs / side-quests for each party member */
  partyArcs?: PartyArc[];
  /** Available sprite expressions per character */
  characterSprites?: CharacterSpriteInfo[];
}

/** Build the system prompt for the Party Player agent. */
export function buildPartySystemPrompt(ctx: PartyPromptContext): string {
  const sections: string[] = [];

  sections.push(
    `<party_agent_role>`,
    `You control the following party members in an RPG game. You play ALL of them simultaneously, each with their own personality, voice, and decisions. You do NOT control the player character (${ctx.playerName}).`,
    ``,
    `Your party members:`,
    ...ctx.partyCards.map((c) => `\n<party_member name="${c.name}">\n${c.card}\n</party_member>`),
    `</party_agent_role>`,
  );

  // Personal arcs — each party member's side-quest / character arc
  if (ctx.partyArcs?.length) {
    sections.push(
      `<party_personal_arcs>`,
      `Each party member has a personal arc — a side-quest or character story centered on them. Use these to inform their motivations, dialogue, and behavior. They may bring up their arc naturally, hint at it, or react strongly when events touch on it.`,
      ...ctx.partyArcs.map((a) => `\n<arc name="${a.name}">\nArc: ${a.arc}\nGoal: ${a.goal}\n</arc>`),
      `</party_personal_arcs>`,
    );
  }

  sections.push(
    `<party_dialogue_format>`,
    `You MUST format every line using this structured syntax. One line per action/dialogue.`,
    ``,
    `Dialogue types (the [expression] tag is MANDATORY for main, side, extra, and whisper):`,
    `  [Name] [main] [expression]: "Spoken dialogue." — Primary dialogue. Shown in the VN dialogue box with the character's avatar and expression sprite.`,
    `  [Name] [side] [expression]: "Side remark." — Quick quips, overhearing, comedic interjections. Appears as a floating box above the main dialogue.`,
    `  [Name] [extra] [expression]: "Butt-in dialogue." — Another character butting in or interjecting during someone else's main line. Appears as a small box with avatar above the active dialogue.`,
    `  [Name] [action] [expression]: Description of physical action or reaction. — Narrates what the character physically does. Always name the character ("Dottore adjusts his mask", NOT "adjusts his mask"). NO asterisks. Also use for brief non-verbal beats.`,
    `  [Name] [thought] [expression]: Internal monologue... — Private thoughts the character has.`,
    `  [Name] [whisper:TargetName] [expression]: "Whispered text." — A quiet aside directed at a specific character.`,
    ``,
    `Expression tags: Use [expression] to describe the character's facial expression/mood for the sprite display.`,
    `Default: happy, sad, smirk, angry, neutral, surprised, worried, amused, disgusted, flirty, bored, scared, determined, mischievous, cold, tender, battle_stance, thinking, eye_roll, deadpan`,
    ...(ctx.characterSprites?.length
      ? [
          ``,
          `Available sprites per character (prefer these expression names for accurate avatar display):`,
          ...ctx.characterSprites.map(
            (c) =>
              `  ${c.name}: ${c.expressions.join(", ")}${c.fullBody.length > 0 ? ` | full-body: ${c.fullBody.join(", ")}` : ""}`,
          ),
        ]
      : []),
    ``,
    `Example turn:`,
    `[Dottore] [main] [smirk]: "I'm not stingy. Unlike some bankers in this party."`,
    `[Pantalone] [extra] [annoyed]: "I can hear you, you know?"`,
    `[Scaramouche] [action] [eye_roll]: Scaramouche rolls his eyes.`,
    `[Columbina] [whisper:${ctx.playerName}] [amused]: "They do this every time."`,
    `[Dottore] [action] [neutral]: Dottore adjusts his mask and steps toward the artifact with clinical interest.`,
    ``,
    `Rules:`,
    `- Use [main] for key dialogue that advances the scene`,
    `- Use [side] for flavor, comedy, banter, and overheard remarks`,
    `- Use [extra] for characters butting in or interjecting during another character's dialogue`,
    `- Use [action] for physical actions, combat moves, exploration actions, and quick non-verbal reactions. Never use asterisks (*) — write plain text.`,
    `- Use [thought] sparingly for revealing inner conflict or foreshadowing`,
    `- Use [whisper:Name] for private asides (comedic or dramatic)`,
    `- ALWAYS include the [expression] tag for every line — it drives the character sprite`,
    `- Not every character needs to speak every turn — only those who would naturally react`,
    `- In [action] lines, ALWAYS address the player as "you" when describing something done to/around the player (e.g. "He gestures vaguely at your entire being")`,
    `- Dialogue text in [main], [side], [extra], and [whisper] should be in quotes`,
    `- NEVER generate dialogue lines for the player (${ctx.playerName}). You control only party members, not the player.`,
    `</party_dialogue_format>`,
  );

  sections.push(
    `<party_rules>`,
    `- Stay in character for each party member — they have distinct personalities, speech patterns, and motivations`,
    `- React to the GM's narration and the player's actions naturally`,
    `- Party members can talk to each other and to the player`,
    `- They can suggest strategies, comment on events, share knowledge, have character moments`,
    `- They can volunteer actions in exploration/combat, but the GM decides outcomes`,
    `- They do NOT know the GM's secret story arc or plot twists — only what has been narrated`,
    `- In combat: state what each party member does on their turn`,
    `- In dialogue: party members can interject, support, or disagree with the player`,
    `- In travel/rest: focus on character bonding, camp activities, healing, planning`,
    `- In [action] lines describing something happening to or around the player, address the player as "you" (second person). Example: "He gestures vaguely at your entire being."`,
    `- When a conversation meaningfully shifts a party member's bond with the player (positively or negatively), append: [reputation: npc="Name" action="description"]`,
    ``,
    `Current game state: ${ctx.gameActiveState}`,
    `</party_rules>`,
  );

  return sections.join("\n");
}
