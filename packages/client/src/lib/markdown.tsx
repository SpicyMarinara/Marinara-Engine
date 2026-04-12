// ──────────────────────────────────────────────
// Shared Markdown rendering utilities
// ──────────────────────────────────────────────
import { type ReactNode } from "react";

// ─── Inline Markdown ────────────────────────────────────────────────────────

/**
 * Comprehensive inline markdown regex.
 *
 * Match order (first match wins at each position):
 *   1     Backslash escape  \X
 *   2–4   Image/Link        ![alt](url)  or  [text](url)
 *   5     Inline code       `code`
 *   6     Highlight         ==text==
 *   7     Strikethrough     ~~text~~
 *   8     Bold-italic       ***text***   (must precede bold)
 *   9     Bold              **text**
 *   10    Italic (__)       __text__
 *   11    Italic (*)        *text*
 *   12    Italic (_)        _text_   (not inside a word)
 */
const INLINE_MD_RE =
  // eslint-disable-next-line no-useless-escape
  /\\([-\\*_~`#|>!=\[\]{}])|(!?\[([^\]]*)\]\((https?:\/\/[^)]+)\))|`([^`\n]+)`|==(.+?)==|~~(.+?)~~|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|(?<![_\w])_([^_]+?)_(?![_\w])/g;

/** Maximum recursion depth for nested inline markdown. */
const MAX_INLINE_DEPTH = 6;

/**
 * Apply inline markdown formatting to a text string.
 * Returns an array of ReactNodes (plain strings + formatted elements).
 *
 * Supports recursive nesting — e.g. `_You **can** combine them_` renders
 * as italic wrapping bold.  Code spans and images are never recursed into.
 *
 * Backslash escapes: `\*`, `\_`, `\~`, etc. output the literal character.
 */
export function applyInlineMarkdown(text: string, keyPrefix: string, _depth = 0): ReactNode[] {
  // Safety: prevent runaway recursion
  if (_depth > MAX_INLINE_DEPTH) return [text];

  const regex = new RegExp(INLINE_MD_RE.source, INLINE_MD_RE.flags);
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  /** Recursively apply inline markdown to inner content. */
  const recurse = (inner: string, tag: string): ReactNode[] =>
    applyInlineMarkdown(inner, `${keyPrefix}${tag}${key}`, _depth + 1);

  while ((match = regex.exec(text)) !== null) {
    // Push any plain text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] != null) {
      // ── Backslash escape: \X → literal character ──
      nodes.push(match[1]);
    } else if (match[3] != null && match[4] != null) {
      // ── Image: ![alt](url) or Link: [text](url) ──
      if (match[0].startsWith("!")) {
        nodes.push(
          <img
            key={`${keyPrefix}img${key++}`}
            src={match[4]}
            alt={match[3] || ""}
            className="my-1 inline-block max-w-full rounded-lg align-bottom sm:max-w-md"
            loading="lazy"
          />,
        );
      } else {
        // Plain link [text](url) — render as anchor
        nodes.push(
          <a
            key={`${keyPrefix}a${key++}`}
            href={match[4]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
          >
            {match[3]}
          </a>,
        );
      }
    } else if (match[5] != null) {
      // ── Inline code: `code` (no recursion — content is literal) ──
      nodes.push(
        <code key={`${keyPrefix}c${key++}`} className="mari-md-inline-code">
          {match[5]}
        </code>,
      );
    } else if (match[6] != null) {
      // ── Highlight: ==text== ──
      nodes.push(
        <mark key={`${keyPrefix}hl${key++}`} className="mari-md-highlight">
          {recurse(match[6], "hl")}
        </mark>,
      );
    } else if (match[7] != null) {
      // ── Strikethrough: ~~text~~ ──
      nodes.push(
        <del key={`${keyPrefix}s${key++}`} className="mari-md-strikethrough">
          {recurse(match[7], "s")}
        </del>,
      );
    } else if (match[8] != null) {
      // ── Bold-italic: ***text*** ──
      nodes.push(
        <strong key={`${keyPrefix}bi${key++}`}>
          <em>{recurse(match[8], "bi")}</em>
        </strong>,
      );
    } else if (match[9] != null) {
      // ── Bold: **text** ──
      nodes.push(<strong key={`${keyPrefix}b${key++}`}>{recurse(match[9], "b")}</strong>);
    } else if (match[10] != null) {
      // ── Italic: __text__ ──
      nodes.push(<em key={`${keyPrefix}di${key++}`}>{recurse(match[10], "di")}</em>);
    } else if (match[11] != null) {
      // ── Italic: *text* ──
      nodes.push(<em key={`${keyPrefix}i${key++}`}>{recurse(match[11], "i")}</em>);
    } else if (match[12] != null) {
      // ── Italic: _text_ ──
      nodes.push(<em key={`${keyPrefix}ui${key++}`}>{recurse(match[12], "ui")}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

// ─── Block-level Markdown ───────────────────────────────────────────────────

/** Regex to match markdown headings at the start of a line. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Regex to match horizontal rules: *** / --- (3+ chars, standalone line). */
const HR_LINE_RE = /^(?:\*{3,}|-{3,})$/;

/** Regex to match a standalone image line (entire line is just one image). */
const MD_IMAGE_LINE_RE = /^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/;

/** Regex to match a task list item: - [ ] or - [x]. */
const TASK_ITEM_RE = /^(\s*)[-*+] \[([ xX])\]\s+(.+)/;

/** Regex to match an unordered list item (-, *, +). */
const UL_ITEM_RE = /^(\s*)[*+-]\s+(.+)/;

/** Regex to match an ordered list item (1., 2., …). */
const OL_ITEM_RE = /^(\s*)\d+\.\s+(.+)/;

/** Regex to match a table row: starts and ends with |. */
const TABLE_ROW_RE = /^\|(.+)\|$/;

/** Regex to match a blockquote line. */
const BLOCKQUOTE_RE = /^\s*>(?: (.*)| *$)/;

/** Regex for the opening of a fenced code block. */
const CODE_FENCE_OPEN_RE = /^`{3,}(.*)$/;

/** Regex for the closing of a fenced code block. */
const CODE_FENCE_CLOSE_RE = /^`{3,}\s*$/;

/** Regex to detect a line starting with an escaped block marker. */
const ESCAPED_BLOCK_RE = /^\s*\\[#>*+\-|`]/;

// ── List item with indent tracking ──

interface ListItem {
  content: string;
  indent: number;
  /** undefined = regular item, false = unchecked task, true = checked task */
  task?: boolean;
}

// ── Table helpers ──

/** Parse alignment from separator cells (e.g. :---, :---:, ---:). */
function parseTableAlign(sep: string): "left" | "center" | "right" | undefined {
  const trimmed = sep.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

// ── Render helpers for each block type ──

function renderCodeBlock(lines: string[], lang: string, blockKey: string): ReactNode {
  const code = lines.join("\n");
  return (
    <pre key={blockKey} className="mari-md-codeblock">
      {lang && <span className="mari-md-codeblock-lang">{lang}</span>}
      <code>{code}</code>
    </pre>
  );
}

function renderBlockquote(
  lines: string[],
  renderInline: (text: string, kp: string) => ReactNode[],
  blockKey: string,
): ReactNode {
  const content = lines.join("\n");
  return (
    <blockquote key={blockKey} className="mari-md-blockquote">
      {renderInline(content, `${blockKey}bq`)}
    </blockquote>
  );
}

function renderList(
  items: ListItem[],
  ordered: boolean,
  renderInline: (text: string, kp: string) => ReactNode[],
  blockKey: string,
): ReactNode {
  // Determine if this list contains any task items
  const hasTaskItems = items.some((item) => item.task !== undefined);

  const elements: ReactNode[] = [];
  let i = 0;
  let itemKey = 0;

  while (i < items.length) {
    const item = items[i]!;
    const children: ListItem[] = [];
    i++;
    // Collect nested items (indent >= 2 means nested under the previous item)
    while (i < items.length && items[i]!.indent >= 2) {
      children.push({
        content: items[i]!.content,
        indent: Math.max(0, items[i]!.indent - 2),
        task: items[i]!.task,
      });
      i++;
    }

    const isTask = item.task !== undefined;
    const ik = itemKey++;

    elements.push(
      <li key={`${blockKey}li${ik}`} className={isTask ? "mari-md-task-item" : undefined}>
        {isTask ? (
          <>
            <input type="checkbox" checked={item.task} disabled readOnly className="mari-md-checkbox" />
            <span>{renderInline(item.content, `${blockKey}li${ik}`)}</span>
          </>
        ) : (
          renderInline(item.content, `${blockKey}li${ik}`)
        )}
        {children.length > 0 && renderList(children, ordered, renderInline, `${blockKey}n${ik}`)}
      </li>,
    );
  }

  const Tag = ordered ? "ol" : "ul";
  let className: string;
  if (hasTaskItems && !ordered) {
    className = "mari-md-task-list";
  } else if (ordered) {
    className = "mari-md-ol";
  } else {
    className = "mari-md-ul";
  }

  return (
    <Tag key={blockKey} className={className}>
      {elements}
    </Tag>
  );
}

function renderTable(
  rows: string[][],
  renderInline: (text: string, kp: string) => ReactNode[],
  blockKey: string,
): ReactNode {
  if (rows.length < 2) {
    // Not enough rows for header + separator — render as plain text
    return null;
  }

  // Check if second row is a separator
  const sepRow = rows[1]!;
  const isSep = sepRow.every((cell) => /^\s*:?-+:?\s*$/.test(cell));

  if (!isSep) {
    // No separator — not a valid table
    return null;
  }

  const headers = rows[0]!;
  const aligns = sepRow.map(parseTableAlign);
  const bodyRows = rows.slice(2);

  return (
    <div key={blockKey} className="mari-md-table-wrapper">
      <table className="mari-md-table">
        <thead>
          <tr>
            {headers.map((cell, ci) => (
              <th key={ci} style={aligns[ci] ? { textAlign: aligns[ci] } : undefined}>
                {renderInline(cell, `${blockKey}th${ci}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci} style={aligns[ci] ? { textAlign: aligns[ci] } : undefined}>
                  {renderInline(row[ci] ?? "", `${blockKey}td${ri}_${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main block-level renderer ──

/**
 * Render a markdown text string into React nodes, handling both block-level
 * and inline syntax.
 *
 * Block-level features: fenced code blocks, blockquotes, unordered lists,
 * ordered lists, task lists, tables, headings, horizontal rules,
 * and standalone images.
 *
 * Inline rendering is delegated to the provided `renderInline` callback,
 * which defaults to `applyInlineMarkdown`.
 */
export function renderMarkdownBlocks(
  text: string,
  renderInline: (text: string, keyPrefix: string) => ReactNode[] = applyInlineMarkdown,
  keyBase = "md",
): ReactNode {
  const lines = text.split("\n");
  const segments: ReactNode[] = [];
  let key = 0;

  // ── Accumulation buffers ──
  let textBuffer: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let quoteBuffer: string[] = [];
  let listItems: ListItem[] = [];
  let listOrdered = false;
  let tableRows: string[][] = [];

  // ── Flush helpers ──

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join("\n");
    if (joined.trim()) {
      segments.push(<span key={`${keyBase}t${key++}`}>{renderInline(joined, `${keyBase}t${key}`)}</span>);
    } else {
      // Preserve blank-line spacing
      segments.push(<span key={`${keyBase}t${key++}`}>{joined}</span>);
    }
    textBuffer = [];
  };

  const flushQuote = () => {
    if (quoteBuffer.length === 0) return;
    segments.push(renderBlockquote(quoteBuffer, renderInline, `${keyBase}bq${key++}`));
    quoteBuffer = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    segments.push(renderList(listItems, listOrdered, renderInline, `${keyBase}l${key++}`));
    listItems = [];
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const rendered = renderTable(tableRows, renderInline, `${keyBase}tbl${key++}`);
    if (rendered) {
      segments.push(rendered);
    } else {
      // Not a valid table — render rows as plain text
      for (const row of tableRows) {
        textBuffer.push(`| ${row.join(" | ")} |`);
      }
      flushText();
    }
    tableRows = [];
  };

  const flushAll = () => {
    flushText();
    flushQuote();
    flushList();
    flushTable();
  };

  // ── Main loop ──

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ── Inside fenced code block ──
    if (inCodeBlock) {
      if (CODE_FENCE_CLOSE_RE.test(line.trimEnd())) {
        segments.push(renderCodeBlock(codeBuffer, codeLang, `${keyBase}cb${key++}`));
        codeBuffer = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        codeBuffer.push(line);
      }
      continue;
    }

    // ── Opening of fenced code block ──
    const codeFenceMatch = CODE_FENCE_OPEN_RE.exec(line.trimStart());
    if (codeFenceMatch && !line.trimStart().slice(3).includes("`")) {
      flushAll();
      inCodeBlock = true;
      codeLang = codeFenceMatch[1]?.trim() ?? "";
      continue;
    }

    // ── Backslash-escaped block marker ──
    // If the line starts with \# \> \- \* \+ \| \` etc., skip block-level
    // detection and let the inline parser handle the escape.
    if (ESCAPED_BLOCK_RE.test(line)) {
      if (quoteBuffer.length > 0) flushQuote();
      if (tableRows.length > 0) flushTable();
      if (listItems.length > 0) flushList();
      textBuffer.push(line);
      continue;
    }

    // ── Heading ──
    const hMatch = HEADING_RE.exec(line);
    if (hMatch) {
      flushAll();
      const level = hMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const Tag = `h${level}` as const;
      segments.push(
        <Tag key={`${keyBase}h${key++}`} className="mari-md-heading">
          {renderInline(hMatch[2]!, `${keyBase}h${key}`)}
        </Tag>,
      );
      continue;
    }

    // ── Horizontal rule ──
    if (HR_LINE_RE.test(line.trim())) {
      flushAll();
      segments.push(<hr key={`${keyBase}hr${key++}`} className="my-3 border-t border-[var(--border)]" />);
      continue;
    }

    // ── Standalone image line ──
    const imgMatch = MD_IMAGE_LINE_RE.exec(line.trim());
    if (imgMatch) {
      flushAll();
      segments.push(
        <img
          key={`${keyBase}img${key++}`}
          src={imgMatch[2]}
          alt={imgMatch[1] || ""}
          className="my-1 max-w-full rounded-lg sm:max-w-md"
          loading="lazy"
        />,
      );
      continue;
    }

    // ── Blockquote ──
    const bqMatch = BLOCKQUOTE_RE.exec(line);
    if (bqMatch) {
      if (quoteBuffer.length === 0) {
        flushText();
        flushList();
        flushTable();
      }
      quoteBuffer.push(bqMatch[1] ?? "");
      continue;
    }

    // If we were in a blockquote and this line doesn't continue it, flush
    if (quoteBuffer.length > 0) {
      flushQuote();
    }

    // ── Table row ──
    const trimmed = line.trim();
    if (TABLE_ROW_RE.test(trimmed)) {
      // Check if this could be a table continuation
      if (tableRows.length === 0) {
        flushText();
        flushList();
      }
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    }

    // If we were in a table and this line doesn't continue it, flush
    if (tableRows.length > 0) {
      flushTable();
    }

    // ── Task list item (must be checked before regular UL) ──
    const taskMatch = TASK_ITEM_RE.exec(line);
    if (taskMatch) {
      if (listItems.length === 0) {
        flushText();
        listOrdered = false;
      } else if (listOrdered) {
        flushList();
        listOrdered = false;
      }
      const checked = taskMatch[2] !== " ";
      listItems.push({ content: taskMatch[3]!, indent: taskMatch[1]!.length, task: checked });
      continue;
    }

    // ── Unordered list item ──
    const ulMatch = UL_ITEM_RE.exec(line);
    if (ulMatch) {
      if (listItems.length === 0) {
        flushText();
        listOrdered = false;
      } else if (listOrdered) {
        // Switching from ordered to unordered — flush old list
        flushList();
        listOrdered = false;
      }
      listItems.push({ content: ulMatch[2]!, indent: ulMatch[1]!.length });
      continue;
    }

    // ── Ordered list item ──
    const olMatch = OL_ITEM_RE.exec(line);
    if (olMatch) {
      if (listItems.length === 0) {
        flushText();
        listOrdered = true;
      } else if (!listOrdered) {
        // Switching from unordered to ordered — flush old list
        flushList();
        listOrdered = true;
      }
      listItems.push({ content: olMatch[2]!, indent: olMatch[1]!.length });
      continue;
    }

    // If we were in a list and this line doesn't continue it, flush
    if (listItems.length > 0) {
      flushList();
    }

    // ── Regular text ──
    textBuffer.push(line);
  }

  // ── Handle unclosed code block ──
  if (inCodeBlock) {
    // Render the unclosed fence as regular text
    textBuffer.push("```" + codeLang);
    textBuffer.push(...codeBuffer);
    codeBuffer = [];
    inCodeBlock = false;
  }

  // ── Flush remaining buffers ──
  flushAll();

  return segments.length === 1 ? segments[0] : <>{segments}</>;
}

// ─── HTML-path inline markdown (string → string) ───────────────────────────

/**
 * Apply inline markdown to an HTML string (for the HTML rendering path).
 * Returns the string with markdown replaced by HTML tags.
 *
 * This is intentionally separate from the React-node version because in the
 * HTML path the content is already a sanitised HTML string that will be set
 * via dangerouslySetInnerHTML.
 */
export function applyInlineMarkdownHTML(html: string): string {
  return (
    html
      // Pre-process: replace backslash-escaped markdown chars with HTML entities
      // so they are not matched by subsequent regex patterns.
      .replace(/\\([-\\*_~`#|>!=[\]{}])/g, (_m, char: string) => `&#${char.charCodeAt(0)};`)
      // Fenced code blocks (``` … ```) — must run before inline code
      .replace(
        /(?:^|(?<=<br[^>]*>))\s*`{3,}([^\n<]*?)(?:<br[^>]*>)([\s\S]*?)(?:<br[^>]*>)\s*`{3,}\s*(?:$|(?=<br[^>]*>))/g,
        (_m, lang: string, code: string) => {
          const langTrimmed = lang.trim();
          const langLabel = langTrimmed ? `<span class="mari-md-codeblock-lang">${langTrimmed}</span>` : "";
          return `<pre class="mari-md-codeblock">${langLabel}<code>${code}</code></pre>`;
        },
      )
      // Inline code: `code`
      .replace(/`([^`\n]+)`/g, '<code class="mari-md-inline-code">$1</code>')
      // Highlight: ==text==
      .replace(/==(.+?)==/g, '<mark class="mari-md-highlight">$1</mark>')
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, '<del class="mari-md-strikethrough">$1</del>')
      // Headings: # through ######
      .replace(/(?:^|(?<=<br[^>]*>))\s*(#{1,6})\s+(.+?)(?=<br|$)/g, (_m, hashes: string, content: string) => {
        const level = hashes.length;
        return `<h${level} class="mari-md-heading">${content.trim()}</h${level}>`;
      })
      // Bold-italic: ***text*** (must precede bold)
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // Bold: **text**
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic: __text__
      .replace(/__(.+?)__/g, "<em>$1</em>")
      // Italic: *text* (single asterisk, not part of **)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
      // Italic: _text_ (not inside a word)
      .replace(/(?<![_\w])_([^_]+?)_(?![_\w])/g, "<em>$1</em>")
      // Blockquote lines: > text (after <br>)
      .replace(
        /(?:^|(?<=<br[^>]*>))\s*&gt;\s?(.+?)(?=<br|$)/g,
        '<blockquote class="mari-md-blockquote">$1</blockquote>',
      )
  );
}
