// ──────────────────────────────────────────────
// Prompt Assembler — Orchestrator
// Builds the final ChatML message array from a
// preset, character info, chat history, lorebooks,
// persona, and per-chat choice selections.
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import type {
  ChatMLMessage,
  PromptPreset,
  PromptSection,
  PromptGroup,
  MarkerConfig,
  WrapFormat,
  GenerationParameters,
} from "@marinara-engine/shared";
import { resolveMacros } from "@marinara-engine/shared";
import type { MacroContext } from "@marinara-engine/shared";
import { wrapContent, wrapGroup } from "./format-engine.js";
import { expandMarker, type MarkerContext } from "./marker-expander.js";
import { mergeAdjacentMessages, squashLeadingSystemMessages } from "./merger.js";
import { injectAtDepth } from "../lorebook/prompt-injector.js";
import { buildPromptMacroContext, collectCharacterDepthPromptEntries } from "./macro-context.js";

// ═══════════════════════════════════════════════
//  Public Interface
// ═══════════════════════════════════════════════

/** Everything the assembler needs to produce a prompt. */
export interface AssemblerInput {
  db: DB;
  /** The prompt preset to use */
  preset: {
    id: string;
    name: string;
    sectionOrder: string; // JSON string of string[]
    groupOrder: string; // JSON string of string[]
    wrapFormat: string; // "xml" | "markdown"
    parameters: string; // JSON string of GenerationParameters
    variableGroups: string;
    variableValues: string;
  };
  /** All sections belonging to this preset (raw DB rows) */
  sections: Array<{
    id: string;
    presetId: string;
    identifier: string;
    name: string;
    content: string;
    role: string;
    enabled: string; // "true" / "false"
    isMarker: string; // "true" / "false"
    groupId: string | null;
    markerConfig: string | null; // JSON string
    injectionPosition: string;
    injectionDepth: number;
    injectionOrder: number;
    forbidOverrides: string;
  }>;
  /** All groups for this preset */
  groups: Array<{
    id: string;
    presetId: string;
    name: string;
    parentGroupId: string | null;
    order: number;
    enabled: string;
    createdAt: string;
  }>;
  /** Choice blocks (preset variables) with their options */
  choiceBlocks: Array<{
    id: string;
    presetId: string;
    variableName: string;
    question: string;
    options: string; // JSON string of ChoiceOption[]
    multiSelect: string; // "true" | "false"
    separator: string;
    randomPick: string; // "true" | "false"
    createdAt: string;
  }>;
  /** Per-chat variable selections: { [variableName]: value | value[] } */
  chatChoices: Record<string, string | string[]>;
  /** Chat context */
  chatId: string;
  characterIds: string[];
  personaId?: string | null;
  personaName: string;
  personaDescription: string;
  personaFields?: {
    personality?: string;
    scenario?: string;
    backstory?: string;
    appearance?: string;
  };
  /** Raw personaStats data (for rpgStats injection) */
  personaStats?: any;
  /** Chat messages from the DB (user + assistant + narrator etc.) */
  chatMessages: ChatMLMessage[];
  /** Current chat summary text (if any) */
  chatSummary?: string | null;
  /** Whether agents are enabled for this chat */
  enableAgents?: boolean;
  /** Per-chat list of active agent type IDs (empty = use global enabled state) */
  activeAgentIds?: string[];
  /** Per-chat list of manually activated lorebook IDs from chat settings */
  activeLorebookIds?: string[];
  /** Pre-computed embedding of chat context for semantic lorebook matching. */
  chatEmbedding?: number[] | null;
  /** Per-chat ephemeral state overrides for lorebook entries (from chat metadata). */
  entryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
  /** Generation trigger labels used by per-entry lorebook include/exclude filters. */
  generationTriggers?: string[];
  /** When set, replaces individual character scenario fields with this group scenario. */
  groupScenarioOverrideText?: string | null;
}

/** Output of the assembler. */
export interface AssemblerOutput {
  /** Final ChatML messages ready for the LLM */
  messages: ChatMLMessage[];
  /** Parsed generation parameters */
  parameters: GenerationParameters;
  /** Any lorebook depth entries that were queued (already injected into messages) */
  lorebookDepthEntriesCount: number;
  /** Updated per-chat entry state overrides after ephemeral processing. Caller should persist to chat metadata. */
  updatedEntryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
}

// ═══════════════════════════════════════════════
//  Main Assembler
// ═══════════════════════════════════════════════

export async function assemblePrompt(input: AssemblerInput): Promise<AssemblerOutput> {
  const wrapFormat = (input.preset.wrapFormat || "xml") as WrapFormat;
  const parameters = JSON.parse(input.preset.parameters) as GenerationParameters;
  const sectionOrder = JSON.parse(input.preset.sectionOrder) as string[];
  const groupOrder = JSON.parse(input.preset.groupOrder) as string[];
  const variableValues = JSON.parse(input.preset.variableValues) as Record<string, string>;

  // Build lookup maps
  const sectionMap = new Map(input.sections.map((s) => [s.id, s]));
  const groupMap = new Map(input.groups.map((g) => [g.id, g]));

  // Inject choice variable values into variableValues
  // chatChoices is { variableName: value | value[] } — resolve and merge into variables so {{varName}} resolves
  for (const cb of input.choiceBlocks) {
    const isMulti = cb.multiSelect === "true";
    const isRandom = cb.randomPick === "true";
    const separator = cb.separator || ", ";
    const selected = input.chatChoices[cb.variableName];

    if (selected !== undefined) {
      if (isMulti && Array.isArray(selected)) {
        // Multi-select: either random-pick one or join all
        if (selected.length === 0) {
          // Fallback to first option
          try {
            const opts = JSON.parse(cb.options) as Array<{ value: string }>;
            if (opts.length > 0 && opts[0]) variableValues[cb.variableName] = opts[0].value;
          } catch {
            /* empty */
          }
        } else if (isRandom) {
          // Random pick: select one at random each generation
          variableValues[cb.variableName] = selected[Math.floor(Math.random() * selected.length)] ?? "";
        } else {
          // Join all selected values with the separator
          variableValues[cb.variableName] = selected.join(separator);
        }
      } else {
        // Single-select or legacy string value
        variableValues[cb.variableName] = Array.isArray(selected) ? (selected[0] ?? "") : selected;
      }
    } else {
      // Default to first option's value if no selection yet
      try {
        const opts = JSON.parse(cb.options) as Array<{ value: string }>;
        if (opts.length > 0 && opts[0]) variableValues[cb.variableName] = opts[0].value;
      } catch {
        /* empty */
      }
    }
  }

  // Build macro context (character names and primary card fields resolved from IDs)
  const macroCtx = await buildPromptMacroContext({
    db: input.db,
    characterIds: input.characterIds,
    personaName: input.personaName,
    personaDescription: input.personaDescription,
    personaFields: input.personaFields,
    variables: variableValues,
    groupScenarioOverrideText: input.groupScenarioOverrideText,
    lastInput: [...input.chatMessages].reverse().find((message) => message.role === "user")?.content,
    chatId: input.chatId,
  });

  // Resolve macros inside variable values themselves (e.g. {{user}} in a choice value)
  for (const key of Object.keys(variableValues)) {
    variableValues[key] = resolveMacros(variableValues[key]!, macroCtx);
  }

  // Build marker context
  const markerCtx: MarkerContext = {
    db: input.db,
    chatId: input.chatId,
    characterIds: input.characterIds,
    personaId: input.personaId ?? null,
    personaName: input.personaName,
    personaDescription: input.personaDescription,
    personaFields: input.personaFields,
    personaStats: input.personaStats,
    chatMessages: input.chatMessages,
    chatSummary: input.chatSummary ?? null,
    wrapFormat,
    enableAgents: input.enableAgents ?? true,
    activeAgentIds: input.activeAgentIds ?? [],
    activeLorebookIds: input.activeLorebookIds ?? [],
    chatEmbedding: input.chatEmbedding ?? null,
    entryStateOverrides: input.entryStateOverrides,
    generationTriggers: input.generationTriggers ?? ["chat"],
    groupScenarioOverrideText: input.groupScenarioOverrideText ?? null,
  };

  // ── Phase 1: Resolve sections in preset order ──
  // Separate ordered sections from depth-injected ones
  const orderedSections: ResolvedSection[] = [];
  const depthSections: ResolvedSection[] = [];
  let lorebookDepthEntriesCount = 0;
  let hasChatSummaryMarker = false;

  for (const sectionId of sectionOrder) {
    const section = sectionMap.get(sectionId);
    if (!section) continue;
    if (section.enabled !== "true") continue;

    // Check if group is enabled
    if (section.groupId) {
      const group = groupMap.get(section.groupId);
      if (group && group.enabled !== "true") continue;
    }

    // Track whether a chat_summary marker is present in the preset
    if (section.isMarker === "true" && section.markerConfig) {
      try {
        const mc = JSON.parse(section.markerConfig) as MarkerConfig;
        if (mc.type === "chat_summary") hasChatSummaryMarker = true;
      } catch {
        /* ignore */
      }
    }

    const resolved = await resolveSection(section, {
      macroCtx,
      markerCtx,
      wrapFormat,
    });

    if (!resolved) continue;

    if (section.injectionPosition === "depth" && section.injectionDepth > 0) {
      depthSections.push(resolved);
    } else {
      orderedSections.push(resolved);
    }
  }

  // ── Phase 2: Group wrapping ──
  // Build ordered messages, wrapping grouped sections
  const messages: ChatMLMessage[] = [];
  const processedSections = new Set<string>();
  let chatHistoryEndIdx = -1; // index in messages[] after the last chat_history message

  // Process in section order, grouping adjacent sections in the same group
  for (let i = 0; i < orderedSections.length; i++) {
    const section = orderedSections[i]!;
    if (processedSections.has(section.id)) continue;

    if (section.groupId) {
      // Collect all consecutive sections in the same group
      const groupSections: ResolvedSection[] = [section];
      processedSections.add(section.id);

      for (let j = i + 1; j < orderedSections.length; j++) {
        const next = orderedSections[j]!;
        if (next.groupId === section.groupId) {
          groupSections.push(next);
          processedSections.add(next.id);
        }
      }

      // Get group info for wrapping
      const group = groupMap.get(section.groupId);
      if (group) {
        const groupMessages = buildGroupMessages(groupSections, group, wrapFormat);
        messages.push(...groupMessages);
      } else {
        // Group not found — just add sections directly
        for (const gs of groupSections) {
          messages.push(...gs.messages);
        }
      }
    } else {
      processedSections.add(section.id);
      if (section.isChatHistory) {
        messages.push(...section.messages);
        chatHistoryEndIdx = messages.length;
      } else {
        messages.push(...section.messages.map((message) => ({ ...message, contextKind: "prompt" as const })));
      }
    }
  }

  // ── Phase 2b: Fallback chat summary injection ──
  // If the preset has no chat_summary marker but a summary exists, append it
  // to the bottom of the first system message so it's always included.
  if (!hasChatSummaryMarker && markerCtx.chatSummary) {
    const wrapped = wrapContent(markerCtx.chatSummary, "Chat Summary", wrapFormat);
    if (wrapped) {
      const firstSystemIdx = messages.findIndex((m) => m.role === "system");
      if (firstSystemIdx >= 0) {
        messages[firstSystemIdx] = {
          ...messages[firstSystemIdx]!,
          content: `${messages[firstSystemIdx]!.content}\n\n${wrapped}`,
          contextKind: "prompt",
        };
      } else {
        // No system message at all — prepend one
        messages.unshift({ role: "system", content: wrapped, contextKind: "prompt" });
      }
    }
  }

  // ── Phase 3: Adjacent same-role merging ──
  let finalMessages = mergeAdjacentMessages(messages);

  // ── Phase 4: Squash leading system messages if enabled ──
  if (parameters.squashSystemMessages) {
    finalMessages = squashLeadingSystemMessages(finalMessages);
  }

  // ── Phase 5: Inject depth-based sections ──
  // Includes both preset sections with depth injection AND lorebook depth entries
  const allDepthEntries: Array<{ content: string; role: string; depth: number }>[] = [];

  if (depthSections.length > 0) {
    allDepthEntries.push(
      depthSections.flatMap((s) =>
        s.messages
          .filter((m) => m.content?.trim())
          .map((m) => ({
            content: m.content,
            role: m.role as "system" | "user" | "assistant",
            depth: s.depth,
          })),
      ),
    );
  }

  if (markerCtx.lorebookDepthEntries && markerCtx.lorebookDepthEntries.length > 0) {
    allDepthEntries.push(
      markerCtx.lorebookDepthEntries.map((entry) => ({
        ...entry,
        content: resolveMacros(entry.content, macroCtx),
      })),
    );
  }

  const characterDepthEntries = await collectCharacterDepthPromptEntries(input.db, input.characterIds, macroCtx);
  if (characterDepthEntries.length > 0) {
    allDepthEntries.push(characterDepthEntries);
  }

  const combinedDepthEntries = allDepthEntries.flat();
  if (combinedDepthEntries.length > 0) {
    finalMessages = injectAtDepth(
      finalMessages,
      combinedDepthEntries as Array<{ content: string; role: "system" | "user" | "assistant"; depth: number }>,
    );
    lorebookDepthEntriesCount = combinedDepthEntries.length;
  }

  // ── Phase 6: Strict role formatting ──
  // Forces proper role ordering: system first, then alternating user/assistant.
  // Sections after chat history are forced to user role.
  if (parameters.strictRoleFormatting) {
    finalMessages = enforceStrictRoles(finalMessages, chatHistoryEndIdx);
  }

  // ── Phase 7: Single user message mode ──
  // Collapses entire prompt into one user message.
  if (parameters.singleUserMessage) {
    const combined = finalMessages
      .map((m) => {
        if (m.role !== "user") return `[${m.role.toUpperCase()}]\n${m.content}`;
        return m.content;
      })
      .join("\n\n");
    finalMessages = [{ role: "user", content: combined }];
  }

  // ── Final: Drop any messages with empty/whitespace-only content ──
  finalMessages = finalMessages.filter((m) => m.content?.trim());

  return {
    messages: finalMessages,
    parameters,
    lorebookDepthEntriesCount,
    ...(markerCtx.updatedEntryStateOverrides
      ? { updatedEntryStateOverrides: markerCtx.updatedEntryStateOverrides }
      : {}),
  };
}

// ═══════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════

interface ResolvedSection {
  id: string;
  groupId: string | null;
  role: "system" | "user" | "assistant";
  messages: ChatMLMessage[];
  depth: number;
  isChatHistory?: boolean;
}

interface ResolveSectionCtx {
  macroCtx: MacroContext;
  markerCtx: MarkerContext;
  wrapFormat: WrapFormat;
}

// ═══════════════════════════════════════════════
//  Section Resolution
// ═══════════════════════════════════════════════

async function resolveSection(
  section: AssemblerInput["sections"][number],
  ctx: ResolveSectionCtx,
): Promise<ResolvedSection | null> {
  const role = section.role as "system" | "user" | "assistant";

  let content = section.content;

  // Handle marker sections
  if (section.isMarker === "true" && section.markerConfig) {
    const markerConfig = JSON.parse(section.markerConfig) as MarkerConfig;
    const expanded = await expandMarker(markerConfig, ctx.markerCtx);

    // Chat history marker returns multiple messages
    if (markerConfig.type === "chat_history" && expanded.messages) {
      return {
        id: section.id,
        groupId: section.groupId,
        role,
        messages: expanded.messages.map((message) => ({
          ...message,
          content: resolveMacros(message.content, ctx.macroCtx),
        })),
        depth: section.injectionDepth,
        isChatHistory: true,
      };
    }

    // Agent data markers: if section has editable content with {{agent::TYPE}} macro,
    // inject expanded data via the macro context so the user's template is preserved
    if (markerConfig.type === "agent_data" && section.content && section.content.trim()) {
      const agentType = markerConfig.agentType ?? "";
      ctx.macroCtx.agentData = {
        ...ctx.macroCtx.agentData,
        [agentType]: expanded.content,
      };
      content = section.content;
    } else {
      // Other markers return content to be wrapped
      content = expanded.content;
      if (!content.trim()) return null;
    }
  }

  // Resolve macros
  content = resolveMacros(content, ctx.macroCtx);
  if (!content.trim()) return null;

  // Auto-wrap in the preset's format
  const wrapped = wrapContent(content, section.name, ctx.wrapFormat);

  return {
    id: section.id,
    groupId: section.groupId,
    role,
    messages: [{ role, content: wrapped || content, contextKind: "prompt" }],
    depth: section.injectionDepth,
  };
}

// ═══════════════════════════════════════════════
//  Group Building
// ═══════════════════════════════════════════════

/**
 * Build messages for a group of sections.
 * If all sections share the same role, wrap them in a group tag.
 * If roles differ, create separate messages per role (no group wrapping across roles).
 */
function buildGroupMessages(
  sections: ResolvedSection[],
  group: { name: string },
  wrapFormat: WrapFormat,
): ChatMLMessage[] {
  // Check if all sections share the same role
  const roles = new Set(sections.map((s) => s.role));

  if (roles.size === 1) {
    // All same role — combine content and wrap in group
    const role = sections[0]!.role;
    const innerContent = sections.flatMap((s) => s.messages.map((m) => m.content)).join("\n\n");
    const wrapped = wrapGroup(innerContent, group.name, wrapFormat);
    return [{ role, content: wrapped || innerContent, contextKind: "prompt" }];
  }

  // Mixed roles — group consecutive same-role sections and wrap each group
  const result: ChatMLMessage[] = [];
  let currentRole: string | null = null;
  let currentParts: string[] = [];

  const flush = () => {
    if (currentRole && currentParts.length > 0) {
      const combined = currentParts.join("\n\n");
      // When roles are mixed, don't apply group wrapping (it would lose the role split)
      result.push({
        role: currentRole as "system" | "user" | "assistant",
        content: combined,
        contextKind: "prompt",
      });
    }
    currentParts = [];
  };

  for (const section of sections) {
    if (section.role !== currentRole) {
      flush();
      currentRole = section.role;
    }
    for (const msg of section.messages) {
      currentParts.push(msg.content);
    }
  }
  flush();

  return result;
}

// ═══════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════

/**
 * Enforce strict role formatting:
 * 1. Leading system messages stay as system.
 * 2. Sections after chat_history are forced to user role.
 * 3. Ensures alternating user/assistant after the system block.
 *    Adjacent same-role messages are merged.
 */
function enforceStrictRoles(messages: ChatMLMessage[], chatHistoryEndIdx: number): ChatMLMessage[] {
  if (messages.length === 0) return messages;

  // Step 1: Force post-chat-history non-user/assistant messages to user
  if (chatHistoryEndIdx > 0) {
    messages = messages.map((m, i) => {
      if (i >= chatHistoryEndIdx && m.role === "system") {
        return { ...m, role: "user" as const };
      }
      return m;
    });
  }

  // Step 2: Collect leading system block
  const result: ChatMLMessage[] = [];
  let idx = 0;
  const systemParts: string[] = [];
  while (idx < messages.length && messages[idx]!.role === "system") {
    systemParts.push(messages[idx]!.content);
    idx++;
  }
  if (systemParts.length > 0) {
    result.push({ role: "system", content: systemParts.join("\n\n") });
  }

  // Step 3: The rest must alternate user/assistant.
  // First non-system should be user.
  let expectedRole: "user" | "assistant" = "user";
  for (; idx < messages.length; idx++) {
    const msg = messages[idx]!;
    const effectiveRole = msg.role === "system" ? "user" : msg.role;

    if (effectiveRole === expectedRole) {
      result.push({ ...msg, role: effectiveRole });
      expectedRole = effectiveRole === "user" ? "assistant" : "user";
    } else {
      // Wrong role — merge into the previous message of the same role, or
      // if this would break alternation, force it to the expected role.
      const prev = result[result.length - 1];
      if (prev && prev.role === effectiveRole) {
        // Merge into previous (same role back-to-back)
        prev.content += "\n\n" + msg.content;
        if (prev.contextKind !== msg.contextKind) {
          delete prev.contextKind;
        }
        if (msg.images?.length) {
          prev.images = [...(prev.images ?? []), ...msg.images];
        }
      } else {
        // Force to expected role to maintain alternation
        result.push({ ...msg, role: expectedRole });
        expectedRole = expectedRole === "user" ? "assistant" : "user";
      }
    }
  }

  return result;
}
