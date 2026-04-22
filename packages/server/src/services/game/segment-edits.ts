// ──────────────────────────────────────────────
// Game: Apply segment edit overlays to message content
// ──────────────────────────────────────────────
//
// The VN narration UI lets users edit individual narration/dialogue segments.
// Edits are stored as chat-metadata overlays (segmentEdit:msgId:segIdx → text)
// rather than rewriting the raw message (which has multi-segment text + GM tags).
//
// Before sending messages to the model we need to apply those overlays so the
// model sees the corrected text. This module mirrors the client-side
// parseNarrationSegments segment-indexing logic just enough to do that.
// ──────────────────────────────────────────────

/**
 * Strip GM command tags from message content.
 * Mirrors the client's `stripGmTagsKeepReadables` (minus readable
 * preservation which is irrelevant for segment editing).
 */
export function stripGmCommandTags(content: string): string {
  let text = content
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "")
    // Catch-all for unknown [tag: value] (but NOT [Name] or [Note:/Book:])
    .replace(/\[(?!Note:|Book:)\w+:[^\]]*\]/g, "");
  // Balanced bracket tags
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  // Orphaned ] from multi-line tags
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}

/** Strip a balanced-bracket tag (handles nested brackets like JSON). */
function stripBalancedTag(text: string, tagPrefix: string): string {
  const lower = tagPrefix.toLowerCase();
  let result = text;
  let searchFrom = 0;
  while (true) {
    const idx = result.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < result.length; i++) {
      if (result[i] === "[") depth++;
      else if (result[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    result = result.slice(0, idx) + result.slice(end + 1);
  }
  return result;
}

// ── Segment parsing (mirrors client parseNarrationSegments indexing) ──

interface ParsedSegment {
  /** Full original text of the segment as it appears in stripped content. */
  originalText: string;
  /** For dialogue lines, the prefix before the spoken content (e.g. `[Kaeya] [smirk]: `). */
  dialoguePrefix?: string;
  /** Whether surrounding quotes were stripped from dialogue content. */
  hadQuotes?: boolean;
}

const PARTY_LINE_RE =
  /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
const COMPACT_DIALOGUE_RE = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
const LEGACY_DIALOGUE_RE = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
const NARRATION_PREFIX_RE = /^\s*Narration\s*:\s*(.+)$/i;
const READABLE_PLACEHOLDER_RE = /^__READABLE_\d+__$/;

/** Check if a dialogue content string has surrounding quotes. */
function hasQuotes(s: string): boolean {
  if (s.length < 2) return false;
  return (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("\u201c") && s.endsWith("\u201d")) ||
    (s.startsWith("\u00ab") && s.endsWith("\u00bb"))
  );
}

/**
 * Parse tag-stripped content into segments matching the client's indexing.
 * Only tracks enough info to locate and replace segment content.
 */
function parseSegments(stripped: string): ParsedSegment[] {
  // Handle readable placeholders the same way the client does:
  // replace [Note: ...] and [Book: ...] with __READABLE_N__ tokens.
  let source = stripped;
  let readableCount = 0;
  for (const tag of ["[Note:", "[Book:"] as const) {
    let searchFrom = 0;
    while (true) {
      const idx = source.toLowerCase().indexOf(tag.toLowerCase(), searchFrom);
      if (idx === -1) break;
      let depth = 0;
      let end = -1;
      for (let i = idx; i < source.length; i++) {
        if (source[i] === "[") depth++;
        else if (source[i] === "]") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) {
        searchFrom = idx + 1;
        continue;
      }
      const placeholder = `__READABLE_${readableCount++}__`;
      source = source.slice(0, idx) + placeholder + source.slice(end + 1);
      searchFrom = idx + placeholder.length;
    }
  }

  const lines = source.split(/\r?\n/);
  const segments: ParsedSegment[] = [];
  let fallbackText = "";

  const flushFallback = () => {
    if (fallbackText.trim()) {
      segments.push({ originalText: fallbackText.trim() });
      fallbackText = "";
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushFallback();
      continue;
    }

    // Readable placeholder → segment
    if (READABLE_PLACEHOLDER_RE.test(line)) {
      flushFallback();
      segments.push({ originalText: line });
      continue;
    }

    // Party dialogue
    const partyMatch = line.match(PARTY_LINE_RE);
    if (partyMatch) {
      flushFallback();
      const spokenContent = partyMatch[5]!.trim();
      const prefixEnd = line.lastIndexOf(partyMatch[5]!);
      const prefix = line.slice(0, prefixEnd);
      const rawType = partyMatch[2]!.toLowerCase().replace(/:.*$/, "");
      const quoted = ["main", "side", "extra", "whisper"].includes(rawType) && hasQuotes(spokenContent);
      segments.push({ originalText: line, dialoguePrefix: prefix, hadQuotes: quoted });
      continue;
    }

    // Legacy `Narration: text`
    const narrationMatch = line.match(NARRATION_PREFIX_RE);
    if (narrationMatch) {
      flushFallback();
      segments.push({ originalText: narrationMatch[1]!.trim() });
      continue;
    }

    // Dialogue (legacy or compact)
    const dialogueMatch = line.match(LEGACY_DIALOGUE_RE) || line.match(COMPACT_DIALOGUE_RE);
    if (dialogueMatch) {
      flushFallback();
      const spokenContent = dialogueMatch[3]!.trim();
      const prefixEnd = line.lastIndexOf(dialogueMatch[3]!);
      const prefix = line.slice(0, prefixEnd);
      const quoted = hasQuotes(spokenContent);
      segments.push({ originalText: line, dialoguePrefix: prefix, hadQuotes: quoted });
      continue;
    }

    // Fallback: accumulate narration
    fallbackText += `${fallbackText ? "\n" : ""}${line}`;
  }

  flushFallback();
  return segments;
}

/**
 * Apply segment edit overlays to a game message's content.
 *
 * @param content  Raw message content (with GM tags)
 * @param edits    Map of unfiltered segment index → edited content text
 * @returns        Modified content with edits applied (command tags stripped,
 *                 since they've already been processed by the engine)
 */
export function applySegmentEdits(content: string, edits: Record<number, string>): string {
  if (Object.keys(edits).length === 0) return content;

  const stripped = stripGmCommandTags(content);
  const segments = parseSegments(stripped);

  let anyApplied = false;
  const output: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const edit = edits[i];

    if (edit !== undefined) {
      anyApplied = true;
      if (seg.dialoguePrefix) {
        // Reconstruct dialogue line: preserve [Name] [expression]: prefix + edited content
        output.push(seg.hadQuotes ? `${seg.dialoguePrefix}"${edit}"` : `${seg.dialoguePrefix}${edit}`);
      } else {
        output.push(edit);
      }
    } else {
      output.push(seg.originalText);
    }
  }

  // If no edits actually matched any segment, return original content unchanged
  return anyApplied ? output.join("\n\n") : content;
}

/**
 * Collect segment edit overlays from chat metadata and apply them to the
 * corresponding messages.
 *
 * @param messages   Array of mapped messages (role + content)
 * @param chatMeta   Chat metadata object (contains segmentEdit:* keys)
 * @param allDbMessages  Original DB messages (to map messageId → index in messages array)
 */
export function applyAllSegmentEdits(
  messages: Array<{ role: string; content: string; [k: string]: unknown }>,
  chatMeta: Record<string, unknown>,
  allDbMessages: Array<{ id: string; role: string }>,
): void {
  // Collect edits grouped by messageId
  const editsByMessage = new Map<string, Record<number, string>>();
  for (const [key, value] of Object.entries(chatMeta)) {
    if (!key.startsWith("segmentEdit:") || typeof value !== "string") continue;
    // Format: segmentEdit:messageId:segmentIndex
    const parts = key.slice("segmentEdit:".length);
    const lastColon = parts.lastIndexOf(":");
    if (lastColon < 0) continue;
    const messageId = parts.slice(0, lastColon);
    const segIdx = parseInt(parts.slice(lastColon + 1), 10);
    if (isNaN(segIdx)) continue;

    let edits = editsByMessage.get(messageId);
    if (!edits) {
      edits = {};
      editsByMessage.set(messageId, edits);
    }
    edits[segIdx] = value;
  }

  if (editsByMessage.size === 0) return;

  // Map messageId → index in messages array
  // allDbMessages and messages should be in the same order (both from the same query)
  for (const [messageId, edits] of editsByMessage) {
    const dbIdx = allDbMessages.findIndex((m) => m.id === messageId);
    if (dbIdx < 0) continue;
    const msg = messages[dbIdx];
    if (!msg || msg.role === "user") continue; // only edit assistant/narrator messages
    msg.content = applySegmentEdits(msg.content, edits);
  }
}
