// ──────────────────────────────────────────────
// Peek Prompt Modal — collapsible section viewer
// ──────────────────────────────────────────────
import { useState, useMemo } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

interface GenerationInfo {
  model?: string;
  provider?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  showThoughts?: boolean | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  tokensCachedPrompt?: number | null;
  tokensCacheWritePrompt?: number | null;
  durationMs?: number | null;
  finishReason?: string | null;
}

interface PeekPromptModalProps {
  data: {
    messages: Array<{ role: string; content: string }>;
    parameters: unknown;
    generationInfo?: GenerationInfo | null;
    agentNote?: string;
  };
  onClose: () => void;
}

function prettifyTag(tag: string): string {
  return tag.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ═══════════════════════════════════════════════
//  Section types for the final display list
// ═══════════════════════════════════════════════

interface SectionBlock {
  kind: "section";
  label: string;
  role: string;
  content: string;
}

interface ChatHistoryEntry {
  role: string;
  content: string;
}

interface ChatHistoryBlock {
  kind: "chat-history";
  entries: ChatHistoryEntry[];
  rawContent: string; // for token counting
}

type DisplaySection = SectionBlock | ChatHistoryBlock;

// ═══════════════════════════════════════════════
//  Parsing: works on the WHOLE messages array
// ═══════════════════════════════════════════════

/**
 * Parse XML sections from a single message's content.
 * Only matches tags whose opening AND closing appear on their own line
 * (prompt-level sections like <system_prompt>, <character_info>, etc.).
 * Returns named blocks; anything between/around sections becomes a block
 * named after the message role.
 */
function parseXmlSections(content: string, fallbackLabel: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  // Match <tag_name>\n...\n</tag_name> where both tags sit on their own line.
  const tagRegex = /(?:^|\n)(<([a-z_][a-z0-9_-]*)>\n[\s\S]*?\n<\/\2>)(?:\n|$)/gi;
  let lastIndex = 0;

  for (const match of content.matchAll(tagRegex)) {
    const matchStart = match.index!;
    const realStart = content[matchStart] === "\n" ? matchStart + 1 : matchStart;
    const before = content.slice(lastIndex, realStart);
    if (before.trim()) {
      blocks.push({ kind: "section", label: fallbackLabel, role: fallbackLabel, content: before.trim() });
    }
    const tagName = match[2]!;
    const tagContent = match[1]!;
    blocks.push({ kind: "section", label: tagName, role: fallbackLabel, content: tagContent.trimEnd() });
    lastIndex = match.index! + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  if (remaining.trim()) {
    blocks.push({ kind: "section", label: fallbackLabel, role: fallbackLabel, content: remaining.trim() });
  }

  return blocks.length > 0 ? blocks : [{ kind: "section", label: fallbackLabel, role: fallbackLabel, content }];
}

/**
 * Build the display section list from the raw messages array.
 *
 * The key challenge: `<chat_history>` opens in one message and closes in another,
 * with bare user/assistant messages in between. We detect boundaries at the
 * array level first, then handle each region appropriately.
 */
function buildDisplaySections(messages: Array<{ role: string; content: string }>): DisplaySection[] {
  // ── Pass 1: find chat history boundaries across the messages array ──
  let chStartIdx = -1;
  let chEndIdx = -1;
  let lastMsgIdx = -1; // <last_message> or ## Last Message

  for (let i = 0; i < messages.length; i++) {
    const c = messages[i]!.content;
    if (chStartIdx < 0 && (/<chat_history>/i.test(c) || /^## Chat History\n/i.test(c))) {
      chStartIdx = i;
    }
    if (/<\/chat_history>/i.test(c)) {
      chEndIdx = i;
    }
    if (/<last_message>/i.test(c) || /^## Last Message\n/i.test(c)) {
      lastMsgIdx = i;
    }
  }

  // If we found an opening tag but no explicit close, the history runs until
  // the message before <last_message>, or to the end of user/assistant messages.
  if (chStartIdx >= 0 && chEndIdx < 0) {
    if (lastMsgIdx > chStartIdx) {
      chEndIdx = lastMsgIdx - 1;
    } else {
      // Find the last consecutive user/assistant message after chStartIdx
      chEndIdx = chStartIdx;
      for (let i = chStartIdx + 1; i < messages.length; i++) {
        const r = messages[i]!.role;
        if (r === "user" || r === "assistant") chEndIdx = i;
        else break;
      }
    }
  }

  // ── Pass 2: build output sections ──
  const result: DisplaySection[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // ── Chat history region ──
    if (chStartIdx >= 0 && i >= chStartIdx && i <= chEndIdx) {
      // Collect all chat history entries in one pass
      const entries: ChatHistoryEntry[] = [];
      const rawParts: string[] = [];
      for (let j = chStartIdx; j <= chEndIdx; j++) {
        let content = messages[j]!.content;
        // Strip the wrapping tags from the content shown inside child blocks
        content = content
          .replace(/^<chat_history>\n?/i, "")
          .replace(/\n?<\/chat_history>\s*$/i, "")
          .replace(/^## Chat History\n?/i, "");
        const trimmed = content.trim();
        if (trimmed) {
          entries.push({ role: messages[j]!.role, content: trimmed });
          rawParts.push(trimmed);
        }
      }
      if (entries.length > 0) {
        result.push({ kind: "chat-history", entries, rawContent: rawParts.join("\n\n") });
      }
      i = chEndIdx; // skip past the whole range
      continue;
    }

    // ── Last message (separate from chat history) ──
    if (i === lastMsgIdx) {
      // The server may merge <last_message> with adjacent same-role sections
      // (e.g. <output_format>) when strict role formatting is on.
      // Split out the <last_message> portion and parse the rest normally.
      const openIdx = msg.content.search(/<last_message>/i);
      const closingIdx = msg.content.search(/<\/last_message>/i);
      if (openIdx >= 0 && closingIdx >= 0) {
        const beforeOpen = msg.content.slice(0, openIdx).trim();
        const innerContent = msg.content.slice(msg.content.indexOf(">", openIdx) + 1, closingIdx).trim();
        const afterClose = msg.content.slice(msg.content.indexOf(">", closingIdx) + 1).trim();

        // Content before <last_message>
        if (beforeOpen) {
          const pre = parseXmlSections(beforeOpen, msg.role);
          for (const b of pre) result.push(b);
        }
        // The last_message block itself
        if (innerContent) {
          result.push({
            kind: "section",
            label: "last_message",
            role: msg.role,
            content: innerContent,
          });
        }
        // Content after </last_message> (e.g. <output_format>)
        if (afterClose) {
          const post = parseXmlSections(afterClose, msg.role);
          for (const b of post) result.push(b);
        }
      } else {
        // Markdown format or no tags — strip heading and show as-is
        const content = msg.content.replace(/^## Last Message\n?/i, "");
        result.push({
          kind: "section",
          label: "last_message",
          role: msg.role,
          content: content.trim(),
        });
      }
      continue;
    }

    // ── System/other messages: parse XML sections within them ──
    const blocks = parseXmlSections(msg.content, msg.role);
    for (const b of blocks) {
      result.push(b);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════
//  UI Components
// ═══════════════════════════════════════════════

function CollapsibleBlock({
  label,
  content,
  defaultOpen,
  roleColor,
}: {
  label: string;
  content: string;
  defaultOpen: boolean;
  roleColor: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tokens = estimateTokens(content);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {open ? (
          <ChevronDown size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span className={cn("rounded-md px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider", roleColor)}>
          {prettifyTag(label)}
        </span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">
          ~{fmtTokens(tokens)} token{tokens !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/50 px-3 py-2">
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--foreground)]/80">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

function ChatHistorySection({ entries, rawContent }: { entries: ChatHistoryEntry[]; rawContent: string }) {
  const [open, setOpen] = useState(false);
  const tokens = estimateTokens(rawContent);

  const msgRoleColor = (role: string) => {
    if (role === "user") return "bg-blue-500/20 text-blue-400";
    if (role === "assistant") return "bg-purple-500/20 text-purple-400";
    return "bg-amber-500/20 text-amber-400";
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
      >
        {open ? (
          <ChevronDown size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider",
            "bg-green-500/20 text-green-400",
          )}
        >
          Chat History
        </span>
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">
          {entries.length} message{entries.length !== 1 ? "s" : ""}
        </span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">
          ~{fmtTokens(tokens)} token{tokens !== 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/50 p-2 space-y-1">
          {entries.map((entry, i) => (
            <ChatHistoryMessage key={i} entry={entry} roleColor={msgRoleColor(entry.role)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatHistoryMessage({ entry, roleColor }: { entry: ChatHistoryEntry; roleColor: string }) {
  const [open, setOpen] = useState(false);
  const tokens = estimateTokens(entry.content);
  const preview = entry.content.split("\n")[0]?.slice(0, 80) ?? "";

  return (
    <div className="rounded-md border border-[var(--border)]/30 bg-[var(--background)]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--accent)]/30"
      >
        {open ? (
          <ChevronDown size="0.625rem" className="shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight size="0.625rem" className="shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span className={cn("rounded px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider", roleColor)}>
          {entry.role}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[0.625rem] text-[var(--muted-foreground)]">{preview}</span>
        )}
        <span className="shrink-0 ml-auto text-[0.5625rem] text-[var(--muted-foreground)]">~{fmtTokens(tokens)}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)]/30 px-2.5 py-1.5">
          <pre className="whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed text-[var(--foreground)]/80">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Main Modal
// ═══════════════════════════════════════════════

export function PeekPromptModal({ data, onClose }: PeekPromptModalProps) {
  const sections = useMemo(() => buildDisplaySections(data.messages), [data.messages]);
  const totalTokens = useMemo(() => estimateTokens(data.messages.map((m) => m.content).join("")), [data.messages]);

  const gen = data.generationInfo;
  const params = data.parameters as Record<string, unknown> | null;

  // Build parameter pills from generationInfo (cached) or assembled parameters
  const paramPills = useMemo(() => {
    const pills: Array<{ label: string; value: string }> = [];
    if (gen) {
      if (gen.temperature != null) pills.push({ label: "Temperature", value: String(gen.temperature) });
      if (gen.maxTokens != null) pills.push({ label: "Max Tokens", value: fmtTokens(gen.maxTokens) });
      if (gen.showThoughts) pills.push({ label: "Thinking", value: "On" });
      if (gen.reasoningEffort) pills.push({ label: "Reasoning", value: gen.reasoningEffort });
      if (gen.verbosity) pills.push({ label: "Verbosity", value: gen.verbosity });
    } else if (params) {
      if (params.temperature != null) pills.push({ label: "Temperature", value: String(params.temperature) });
      if (params.topP != null && params.topP !== 1) pills.push({ label: "Top P", value: String(params.topP) });
      if (params.topK != null && params.topK !== 0) pills.push({ label: "Top K", value: String(params.topK) });
      if (params.minP != null && params.minP !== 0) pills.push({ label: "Min P", value: String(params.minP) });
      if (params.maxTokens != null) pills.push({ label: "Max Tokens", value: fmtTokens(params.maxTokens as number) });
      if (params.frequencyPenalty != null && params.frequencyPenalty !== 0)
        pills.push({ label: "Freq Penalty", value: String(params.frequencyPenalty) });
      if (params.presencePenalty != null && params.presencePenalty !== 0)
        pills.push({ label: "Pres Penalty", value: String(params.presencePenalty) });
      if (params.showThoughts) pills.push({ label: "Thinking", value: "On" });
      if (params.reasoningEffort) pills.push({ label: "Reasoning", value: String(params.reasoningEffort) });
      if (params.verbosity) pills.push({ label: "Verbosity", value: String(params.verbosity) });
    }
    return pills;
  }, [gen, params]);

  const sectionRoleColor = (role: string, label: string) => {
    if (/last.?message/i.test(label)) return "bg-blue-500/20 text-blue-400";
    if (role === "system") return "bg-amber-500/20 text-amber-400";
    if (role === "user") return "bg-blue-500/20 text-blue-400";
    return "bg-purple-500/20 text-purple-400";
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold">Assembled Prompt</h3>
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              {sections.length} section{sections.length !== 1 ? "s" : ""} &middot; ~{fmtTokens(totalTokens)} tokens
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-2">
          {/* Generation info panel */}
          {(gen || paramPills.length > 0) && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
                {gen?.model && (
                  <span className="font-medium text-[var(--foreground)]">
                    {gen.provider ? (
                      <span className="text-[var(--muted-foreground)] font-normal">{gen.provider} / </span>
                    ) : null}
                    {gen.model}
                  </span>
                )}
                <span className="text-[var(--muted-foreground)]">
                  ~{fmtTokens(totalTokens)} est. tokens
                  {gen?.tokensPrompt != null && <> · {fmtTokens(gen.tokensPrompt)} actual prompt tokens</>}
                  {(gen?.tokensCachedPrompt ?? 0) > 0 && <> · {fmtTokens(gen?.tokensCachedPrompt ?? 0)} cached</>}
                  {(gen?.tokensCacheWritePrompt ?? 0) > 0 && (
                    <> · {fmtTokens(gen?.tokensCacheWritePrompt ?? 0)} cache write</>
                  )}
                </span>
              </div>
              {paramPills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {paramPills.map((p) => (
                    <span
                      key={p.label}
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/50 px-2 py-0.5 text-[0.625rem]"
                    >
                      <span className="text-[var(--muted-foreground)]">{p.label}</span>
                      <span className="font-medium text-[var(--foreground)]">{p.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {data.agentNote && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[0.6875rem] text-amber-300/80">
              ⚠ {data.agentNote}
            </div>
          )}
          {sections.map((s, i) =>
            s.kind === "chat-history" ? (
              <ChatHistorySection key={i} entries={s.entries} rawContent={s.rawContent} />
            ) : (
              <CollapsibleBlock
                key={i}
                label={s.label}
                content={s.content}
                defaultOpen={false}
                roleColor={sectionRoleColor(s.role, s.label)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
