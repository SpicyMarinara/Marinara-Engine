// ──────────────────────────────────────────────
// Party Dialogue Parser
//
// Parses structured party response lines into
// typed dialogue lines for the narration system.
//
// Format:
//   [Name] [main] [expression]: "Dialogue text here."
//   [Name] [side] [expression]: "Side remark text."
//   [Name] [action] [expression]: Description of action.
//   [Name] [thought] [expression]: Internal monologue text.
//   [Name] [whisper:Target] [expression]: "Whispered text."
//   [Name] [react] [expression]: *expression/gesture*
//   Expression tag is optional — lines without it still parse.
// ──────────────────────────────────────────────

import type { PartyDialogueLine, PartyDialogueType } from "@marinara-engine/shared";
import { stripSurroundingDialogueQuotes } from "./dialogue-quotes";

const VALID_TYPES = new Set<PartyDialogueType>(["main", "side", "extra", "action", "thought", "whisper"]);

/**
 * Parse a single line of party dialogue.
 *
 * Matches: [CharName] [type] [expression]: content
 *     or:  [CharName] [type]: content  (expression optional)
 *     or:  [CharName] [whisper:TargetName] [expression]: content
 */
const PARTY_LINE_RE =
  /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;

// Fallback for malformed lines like `[Name] [expression]:` or `[Name] [expression] [expression]:`
// where the model forgot the type slot. We default the type to "main" and use the first/last
// non-type bracket as the expression. Skips lines whose second bracket *is* a valid type.
const FALLBACK_LINE_RE = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\](?:\s*\[([^\]]+)\])?\s*:\s*(.+)$/;

export function parsePartyDialogue(raw: string): PartyDialogueLine[] {
  const lines = raw.split(/\r?\n/);
  const result: PartyDialogueLine[] = [];
  let skipped = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let character: string;
    let rawType: string;
    let target: string | undefined;
    let expression: string | undefined;
    let content: string;

    const match = trimmed.match(PARTY_LINE_RE);
    if (match) {
      character = match[1]!.trim();
      rawType = match[2]!.toLowerCase().replace(/:.*$/, ""); // strip :Target from whisper:Target
      target = match[3]?.trim() || undefined;
      expression = match[4]?.trim() || undefined;
      content = match[5]!.trim();
    } else {
      // Tolerant fallback: `[Name] [expr]:` or `[Name] [expr1] [expr2]:` (model duplicated/dropped type)
      const fb = trimmed.match(FALLBACK_LINE_RE);
      if (!fb) {
        skipped++;
        continue;
      }
      const tag2 = fb[2]!.trim().toLowerCase().replace(/:.*$/, "");
      // Don't double-handle anything PARTY_LINE_RE was supposed to catch
      if (VALID_TYPES.has(tag2 as PartyDialogueType) || tag2.startsWith("whisper")) {
        skipped++;
        continue;
      }
      character = fb[1]!.trim();
      rawType = "main";
      // Prefer the last non-type bracket as the expression (handles `[expr] [expr]` duplicates)
      expression = (fb[3] ?? fb[2])!.trim() || undefined;
      content = fb[4]!.trim();
    }

    if (!VALID_TYPES.has(rawType as PartyDialogueType)) continue;

    // Normalize legacy `extra` → `side` (the two types were always identical; `extra` is kept
    // in the union only so historical saved messages still parse).
    if (rawType === "extra") rawType = "side";

    // Strip surrounding dialogue quotes if present (for main/side/extra/whisper dialogue)
    if (
      (rawType === "main" || rawType === "side" || rawType === "extra" || rawType === "whisper") &&
      content.length >= 2
    ) {
      content = stripSurroundingDialogueQuotes(content);
    }

    result.push({
      character,
      type: rawType as PartyDialogueType,
      content,
      ...(target ? { target } : {}),
      ...(expression ? { expression } : {}),
    });
  }

  if (skipped > 0) {
    console.warn(`[party-dialogue-parser] Skipped ${skipped} non-matching line(s) from party response`);
  }

  return result;
}
