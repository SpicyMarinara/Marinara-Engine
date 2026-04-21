// ──────────────────────────────────────────────
// Agent Executor — Single & Batched LLM execution
// ──────────────────────────────────────────────
import type { BaseLLMProvider, ChatMessage, LLMToolDefinition, LLMToolCall } from "../llm/base-provider.js";
import type { AgentResult, AgentContext, AgentResultType } from "@marinara-engine/shared";
import { getDefaultAgentPrompt } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";

/** Strip HTML/XML-style tags (e.g. <div style="..."> <br> <speaker>) from text to save tokens. */
function stripHtmlTags(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Minimal agent config needed for execution. */
export interface AgentExecConfig {
  id: string;
  type: string;
  name: string;
  phase: string;
  promptTemplate: string;
  connectionId: string | null;
  settings: Record<string, unknown>;
}

/** Optional tool context for agents that need function calling. */
export interface AgentToolContext {
  tools: LLMToolDefinition[];
  executeToolCall: (call: LLMToolCall) => Promise<string>;
}

/**
 * Execute a single agent: build prompt → call LLM → parse response.
 * If toolContext is provided, the agent can make tool calls in a loop.
 */
export async function executeAgent(
  config: AgentExecConfig,
  context: AgentContext,
  provider: BaseLLMProvider,
  model: string,
  toolContext?: AgentToolContext,
): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    // Build the agent's system prompt with <role> + <lore> + <agents> + extras
    const template = config.promptTemplate || getDefaultAgentPrompt(config.type);
    if (!template) {
      return makeError(config, "No prompt template configured", startTime);
    }

    const systemParts: string[] = [];
    systemParts.push(`<role>`);
    systemParts.push(`You are a specialized agent. Fulfill your task and return the requested output.`);
    systemParts.push(`</role>`);
    systemParts.push(``);
    systemParts.push(buildLoreBlock(context));
    systemParts.push(``);
    systemParts.push(`<agents>`);
    systemParts.push(`Fulfill the requested task here and return the output in the format specified:`);
    systemParts.push(template);
    systemParts.push(`</agents>`);
    const extras = buildAgentExtras(context, [config.type]);
    if (extras) {
      systemParts.push(``);
      systemParts.push(extras);
    }

    // Build multi-turn message array for this agent (sliced to its own contextSize)
    const agentContextSize = (config.settings.contextSize as number) || 5;
    const messages = buildAgentMessages(systemParts.join("\n"), context, config.type, agentContextSize);

    // Agents use lower temperature for reliability
    const temperature = (config.settings.temperature as number) ?? 0.3;
    const rawMaxTokens = Math.max((config.settings.maxTokens as number) ?? 4096, 16384);
    const maxTokens =
      provider.maxTokensOverrideValue !== null ? Math.min(rawMaxTokens, provider.maxTokensOverrideValue) : rawMaxTokens;
    const streamResponses = context.streaming !== false;

    // If tools are available, use the tool call loop
    if (toolContext && toolContext.tools.length > 0) {
      return executeAgentWithTools(
        config,
        messages,
        provider,
        model,
        temperature,
        maxTokens,
        toolContext,
        streamResponses,
        startTime,
        context.signal,
      );
    }

    // Call LLM (streaming to avoid proxy timeouts, no tools)
    logger.info(`[agent] ${config.type} (${config.name}) — ${model}`);
    for (const msg of messages) {
      logger.debug(`[agent] [${msg.role}] ${msg.content}`);
    }
    logger.debug(`[agent] ═══ END PROMPT — temperature=${temperature} maxTokens=${maxTokens} ═══\n`);

    let responseText = "";
    const result = await provider.chatComplete(messages, {
      model,
      temperature,
      maxTokens,
      stream: streamResponses,
      onToken: streamResponses
        ? (chunk) => {
            responseText += chunk;
          }
        : undefined,
      signal: context.signal,
    });

    if (!responseText && result.content) responseText = result.content;
    responseText = responseText.trim();
    const durationMs = Date.now() - startTime;

    logger.info(`[agent] ${config.type} done (${responseText.length} chars, ${durationMs}ms)`);
    logger.debug(`[agent] ${config.type} raw response: ${responseText.slice(0, 500)}`);

    // Parse the result based on agent type
    const parsed = parseAgentResponse(config.type, responseText);

    return {
      agentId: config.id,
      agentType: config.type,
      type: parsed.type,
      data: parsed.data,
      tokensUsed: result.usage?.totalTokens ?? 0,
      durationMs,
      success: true,
      error: null,
    };
  } catch (err) {
    return makeError(config, extractErrorMessage(err), startTime);
  }
}

/**
 * Execute an agent with tool-calling support.
 * Loops: call LLM → handle tool calls → feed results back → repeat until final response.
 */
async function executeAgentWithTools(
  config: AgentExecConfig,
  initialMessages: ChatMessage[],
  provider: BaseLLMProvider,
  model: string,
  temperature: number,
  maxTokens: number,
  toolContext: AgentToolContext,
  streamResponses: boolean,
  startTime: number,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const MAX_TOOL_ROUNDS = 5;
  const loopMessages = [...initialMessages];
  let totalTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await provider.chatComplete(loopMessages, {
      model,
      temperature,
      maxTokens,
      stream: streamResponses,
      tools: toolContext.tools,
      signal,
    });

    totalTokens += result.usage?.totalTokens ?? 0;

    // No tool calls → final response
    if (!result.toolCalls || result.toolCalls.length === 0) {
      const responseText = result.content?.trim() ?? "";
      const parsed = parseAgentResponse(config.type, responseText);
      return {
        agentId: config.id,
        agentType: config.type,
        type: parsed.type,
        data: parsed.data,
        tokensUsed: totalTokens,
        durationMs: Date.now() - startTime,
        success: true,
        error: null,
      };
    }

    // Append assistant message with tool calls
    loopMessages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    });

    // Execute each tool call and append results
    for (const tc of result.toolCalls) {
      console.log(`[agent-tools] ${config.type} calling: ${tc.function.name}(${tc.function.arguments})`);
      const toolResult = await toolContext.executeToolCall(tc);
      console.log(`[agent-tools] ${config.type} result: ${toolResult.slice(0, 1000)}${toolResult.length > 1000 ? "..." : ""}`);
      loopMessages.push({
        role: "tool",
        content: toolResult,
        tool_call_id: tc.id,
      });
    }
  }

  // Exhausted tool rounds — make one final call without tools to get JSON response
  const finalResult = await provider.chatComplete(loopMessages, {
    model,
    temperature,
    maxTokens,
    stream: streamResponses,
    signal,
  });
  totalTokens += finalResult.usage?.totalTokens ?? 0;
  const responseText = finalResult.content?.trim() ?? "";
  const parsed = parseAgentResponse(config.type, responseText);
  return {
    agentId: config.id,
    agentType: config.type,
    type: parsed.type,
    data: parsed.data,
    tokensUsed: totalTokens,
    durationMs: Date.now() - startTime,
    success: true,
    error: null,
  };
}

// ──────────────────────────────────────────────
// Batched Execution — Multiple agents in one LLM call
// ──────────────────────────────────────────────

/**
 * Execute multiple agents in a single LLM call.
 * Combines all agent prompts into one request using XML-delimited sections,
 * then parses the combined response back into individual AgentResults.
 *
 * All agents in the batch MUST share the same provider+model.
 * Falls back to individual calls if the batch response can't be parsed.
 */
export async function executeAgentBatch(
  configs: AgentExecConfig[],
  context: AgentContext,
  provider: BaseLLMProvider,
  model: string,
): Promise<AgentResult[]> {
  if (configs.length === 0) return [];
  if (configs.length === 1) {
    logger.info(`[agent-batch] Only 1 agent (${configs[0]!.type}), running individually`);
    return [await executeAgent(configs[0]!, context, provider, model)];
  }

  logger.info(`[agent-batch] Batching ${configs.length} agents: [${configs.map((c) => c.type).join(", ")}]`);

  const startTime = Date.now();

  try {
    // Build merged system prompt (includes lore + agent extras)
    const systemPrompt = buildBatchSystemPrompt(configs, context);
    // Batch uses the max contextSize among its members
    const batchContextSize = Math.max(...configs.map((c) => (c.settings.contextSize as number) || 5));
    const messages = buildAgentMessages(systemPrompt, context, "__batch__", batchContextSize);

    // Each agent needs enough room for its full JSON output.
    // Use a generous floor (16384) so the model never runs out mid-response.
    // Cap to the connection-level maxTokensOverride when set.
    const maxTokensPerAgent = Math.max(...configs.map((c) => (c.settings.maxTokens as number) ?? 4096));
    const temperature = Math.min(...configs.map((c) => (c.settings.temperature as number) ?? 0.3));
    const rawBatchMaxTokens = Math.max(maxTokensPerAgent * configs.length, 16384);
    const batchMaxTokens =
      provider.maxTokensOverrideValue !== null
        ? Math.min(rawBatchMaxTokens, provider.maxTokensOverrideValue)
        : rawBatchMaxTokens;
    const streamResponses = context.streaming !== false;
    logger.info(
      `[agent-batch] maxTokens: ${batchMaxTokens} (${maxTokensPerAgent} × ${configs.length} agents, floor 16384${provider.maxTokensOverrideValue !== null ? `, capped at ${provider.maxTokensOverrideValue}` : ""})`,
    );

    logger.debug(`\n[agent-batch] ═══ BATCH PROMPT — [${configs.map((c) => c.type).join(", ")}] — ${model} ═══`);
    for (const msg of messages) {
      logger.debug(`[agent-batch] [${msg.role}] ${msg.content}`);
    }
    logger.debug(`[agent-batch] ═══ END BATCH PROMPT — temperature=${temperature} maxTokens=${batchMaxTokens} ═══\n`);

    // Use streaming (onToken) to keep the connection alive — avoids proxy
    // timeouts (e.g. Cloudflare 524) on large batch responses.
    let responseText = "";
    const result = await provider.chatComplete(messages, {
      model,
      temperature,
      maxTokens: batchMaxTokens,
      stream: streamResponses,
      onToken: streamResponses
        ? (chunk) => {
            responseText += chunk;
          }
        : undefined,
      signal: context.signal,
    });

    // chatComplete also accumulates content, but streaming via onToken is
    // the primary path — use whichever is populated.
    if (!responseText && result.content) responseText = result.content;
    responseText = responseText.trim();
    const durationMs = Date.now() - startTime;
    const totalTokens = result.usage?.totalTokens ?? 0;

    logger.info(`[agent-batch] Got response (${responseText.length} chars, ${durationMs}ms, ${totalTokens} tokens)`);
    logger.debug(`[agent-batch] ${responseText}`);

    // Parse the batched response into individual results
    const { parsed, failed } = parseBatchResponse(configs, responseText, durationMs, totalTokens);

    logger.info(
      "[agent-batch] Batch parse: %d parsed, %d failed %s",
      parsed.length,
      failed.length,
      failed.length > 0 ? `Failed: [${failed.map((f) => f.type).join(", ")}]` : "",
    );

    // Retry failed agents individually (batch fallback)
    if (failed.length > 0) {
      logger.info(`[agent-batch] Retrying ${failed.length} failed agents individually...`);
      const retrySettled = await Promise.allSettled(
        failed.map((config) => executeAgent(config, context, provider, model)),
      );
      const retries: AgentResult[] = [];
      for (let i = 0; i < retrySettled.length; i++) {
        const entry = retrySettled[i]!;
        if (entry.status === "fulfilled") {
          retries.push(entry.value);
        } else {
          // Individual retry also failed — produce error result
          logger.error(entry.reason, "[agent-batch] Individual retry FAILED for %s", failed[i]!.type);
          retries.push(
            makeError(failed[i]!, entry.reason instanceof Error ? entry.reason.message : "Retry failed", startTime),
          );
        }
      }
      return [...parsed, ...retries];
    }

    return parsed;
  } catch (err) {
    // On failure, return errors for all agents in the batch
    const errMsg = err instanceof Error ? err.message : "Batch execution failed";
    logger.error(err, "[agent-batch] Batch call FAILED: %s", errMsg);
    return configs.map((c) => makeError(c, errMsg, startTime));
  }
}

/**
 * Build a combined system prompt for a batch of agents.
 * Structure: <role> + <lore> + <agents> + extras
 */
function buildBatchSystemPrompt(configs: AgentExecConfig[], context: AgentContext): string {
  const parts: string[] = [];

  // ── Role ──
  parts.push(`<role>`);
  parts.push(
    `You are a collection of ${configs.length} specialized agents. Fulfill all tasks and return all requested outputs.`,
  );
  parts.push(
    `You MUST wrap each task's output in a <result> tag with the agent ID. Output ALL ${configs.length} result blocks.`,
  );
  parts.push(`</role>`);

  // ── Lore ──
  parts.push(``);
  parts.push(buildLoreBlock(context));

  // ── Agents ──
  parts.push(``);
  parts.push(`<agents>`);
  parts.push(`Fulfill each of the requested tasks here and return the outputs in the formats they're specified:`);
  for (const config of configs) {
    const template = config.promptTemplate || getDefaultAgentPrompt(config.type);
    parts.push(``);
    parts.push(`<agent_task id="${config.type}" name="${config.name}">`);
    parts.push(template);
    parts.push(`</agent_task>`);
  }
  parts.push(`</agents>`);

  // ── Agent-specific extras (sprites, backgrounds, etc.) ──
  const extras = buildAgentExtras(
    context,
    configs.map((c) => c.type),
  );
  if (extras) {
    parts.push(``);
    parts.push(extras);
  }

  // ── Output format ──
  parts.push(``);
  parts.push(`─── REQUIRED OUTPUT FORMAT ───`);
  for (const config of configs) {
    const isJson = JSON_AGENTS.has(config.type);
    parts.push(
      `<result agent="${config.type}">`,
      isJson ? `{ ... valid JSON ... }` : `... your text output ...`,
      `</result>`,
    );
  }
  parts.push(``);
  parts.push(
    `CRITICAL: Output ALL ${configs.length} result blocks. Use exact agent IDs: ${configs.map((c) => c.type).join(", ")}. JSON agents must output valid JSON (no markdown fences). No text outside <result> blocks.`,
  );

  return parts.join("\n");
}

/**
 * Parse a batched LLM response into individual AgentResults.
 * Looks for <result agent="type">...</result> blocks.
 */
function parseBatchResponse(
  configs: AgentExecConfig[],
  responseText: string,
  totalDurationMs: number,
  totalTokens: number = 0,
): { parsed: AgentResult[]; failed: AgentExecConfig[] } {
  const perAgentDuration = Math.round(totalDurationMs / configs.length);
  const perAgentTokens = Math.round(totalTokens / configs.length);
  const parsed: AgentResult[] = [];
  const failed: AgentExecConfig[] = [];

  for (const config of configs) {
    const escaped = escapeRegex(config.type);
    // Try several patterns the model might use:
    // 1. <result agent="type">...</result>
    // 2. <result agent='type'>...</result>
    // 3. <result agent=type>...</result>  (unquoted)
    // 4. <result_type>...</result_type>   (underscore variant)
    // 5. <type>...</type>                 (bare agent ID as tag)
    //
    // We use GREEDY match ([\s\S]*) with a lookahead for the closing tag
    // or the next <result to avoid stopping at a </result> inside JSON strings.
    const patterns = [
      new RegExp(
        `<result\\s+agent\\s*=\\s*["']${escaped}["']\\s*>([\\s\\S]*?)</result\\s*>(?=\\s*(?:<result\\b|$))`,
        "i",
      ),
      new RegExp(`<result\\s+agent\\s*=\\s*["']${escaped}["']\\s*>([\\s\\S]*?)</result>`, "i"),
      new RegExp(`<result\\s+agent\\s*=\\s*${escaped}\\s*>([\\s\\S]*?)</result>`, "i"),
      new RegExp(`<result_${escaped}>([\\s\\S]*?)</result_${escaped}>`, "i"),
      new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`, "i"),
    ];

    let matchedOutput: string | null = null;
    for (const pattern of patterns) {
      const match = responseText.match(pattern);
      if (match) {
        matchedOutput = match[1]!.trim();
        break;
      }
    }

    if (matchedOutput !== null) {
      const parsedResult = parseAgentResponse(config.type, matchedOutput);
      parsed.push({
        agentId: config.id,
        agentType: config.type,
        type: parsedResult.type,
        data: parsedResult.data,
        tokensUsed: perAgentTokens,
        durationMs: perAgentDuration,
        success: true,
        error: null,
      });
    } else {
      // Could not find this agent's output — mark for individual retry
      failed.push(config);
    }
  }

  return { parsed, failed };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Helpers ──

function makeError(config: AgentExecConfig, error: string, startTime: number): AgentResult {
  return {
    agentId: config.id,
    agentType: config.type,
    type: AGENT_RESULT_TYPE_MAP[config.type] ?? "context_injection",
    data: null,
    tokensUsed: 0,
    durationMs: Date.now() - startTime,
    success: false,
    error,
  };
}

/** Extract a useful message from fetch/network errors (preserves err.cause). */
export function extractErrorMessage(err: unknown, fallback = "Agent execution failed"): string {
  if (!(err instanceof Error)) return fallback;
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return `${err.message}: ${cause.message}`;
  }
  return err.message || fallback;
}

/**
 * Build the full multi-turn message array for an agent call.
 *
 * Layout (matches the canonical agent prompt structure):
 *
 *   SYSTEM MESSAGE:
 *     <role> ... </role>
 *     <lore> lorebook entries, characters, persona </lore>
 *     <agents> agent instructions </agents>
 *     (plus any agent-specific context: sprites, backgrounds, source material, etc.)
 *
 *   USER/ASSISTANT MESSAGES:
 *     Recent chat history as proper multi-turn messages
 *     (committed tracker state appended to last 3 assistant messages)
 *
 *   FINAL USER MESSAGE:
 *     assistant_response (if post-processing) + "Now return the requested format(s)."
 */
function buildAgentMessages(
  systemPrompt: string,
  context: AgentContext,
  agentType: string,
  contextSize = 5,
): ChatMessage[] {
  // ── 1. System message — already contains <role>, <lore>, <agents>, and extras ──
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // ── 2. Chat history as proper multi-turn messages ──
  // Slice to this agent's own contextSize (the shared pool may be larger)
  const recent = context.recentMessages.slice(-contextSize);
  if (recent.length > 0) {
    // Only attach committed tracker state to the last 3 assistant messages to save tokens
    const assistantIndices: number[] = [];
    for (let i = 0; i < recent.length; i++) {
      if (recent[i]!.role === "assistant" && recent[i]!.gameState) {
        assistantIndices.push(i);
      }
    }
    const trackerEligible = new Set(assistantIndices.slice(-3));

    for (let msgIdx = 0; msgIdx < recent.length; msgIdx++) {
      const msg = recent[msgIdx]!;
      const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
      let content = stripHtmlTags(msg.content).slice(0, 2000);

      // Append committed tracker data only to the last 3 assistant messages
      if (msg.gameState && trackerEligible.has(msgIdx)) {
        const gs = msg.gameState;
        const trackerSummary: Record<string, unknown> = {};
        if (gs.date || gs.time || gs.location || gs.weather || gs.temperature) {
          trackerSummary.scene = {
            ...(gs.date ? { date: gs.date } : {}),
            ...(gs.time ? { time: gs.time } : {}),
            ...(gs.location ? { location: gs.location } : {}),
            ...(gs.weather ? { weather: gs.weather } : {}),
            ...(gs.temperature ? { temperature: gs.temperature } : {}),
          };
        }
        if (gs.presentCharacters?.length) trackerSummary.presentCharacters = gs.presentCharacters;
        if (gs.recentEvents?.length) trackerSummary.recentEvents = gs.recentEvents;
        if (gs.playerStats) trackerSummary.playerStats = gs.playerStats;
        if (gs.personaStats?.length) trackerSummary.personaStats = gs.personaStats;
        if (Object.keys(trackerSummary).length > 0) {
          content += `\n\n<committed_tracker_state>\n${JSON.stringify(trackerSummary)}\n</committed_tracker_state>`;
        }
      }

      // Merge consecutive messages with the same role (API requirement)
      const last = messages[messages.length - 1]!;
      if (last.role === role) {
        messages[messages.length - 1] = { ...last, content: last.content + "\n\n" + content };
      } else {
        messages.push({ role, content });
      }
    }
  }

  // ── 3. Final instruction (user message) ──
  const finalParts: string[] = [];

  if (context.mainResponse) {
    finalParts.push(`<assistant_response>`);
    finalParts.push(stripHtmlTags(context.mainResponse));
    finalParts.push(`</assistant_response>`);
  }

  if (context.memory._agentResults) {
    finalParts.push(`\n<agent_results>`);
    finalParts.push(JSON.stringify(context.memory._agentResults));
    finalParts.push(`</agent_results>`);
  }

  if (finalParts.length > 0) {
    finalParts.push("\nNow return the requested format(s).");
    const finalContent = finalParts.join("\n");
    const last = messages[messages.length - 1]!;
    if (last.role === "user") {
      messages[messages.length - 1] = { ...last, content: last.content + "\n\n" + finalContent };
    } else {
      messages.push({ role: "user", content: finalContent });
    }
  }

  return messages;
}

/**
 * Build the lore block for the system message from the agent context.
 * Contains lorebook entries, characters, and persona.
 */
function buildLoreBlock(context: AgentContext): string {
  const parts: string[] = [];
  parts.push(`<lore>`);

  if (context.activatedLorebookEntries && context.activatedLorebookEntries.length > 0) {
    parts.push(`<lorebook_entries>`);
    for (const entry of context.activatedLorebookEntries) {
      parts.push(`[${entry.tag}] ${entry.name}: ${entry.content}`);
    }
    parts.push(`</lorebook_entries>`);
  }

  if (context.characters.length > 0) {
    parts.push(`<characters>`);
    for (const char of context.characters) {
      parts.push(`- ${char.name}: ${char.description.slice(0, 2000)}`);
    }
    parts.push(`</characters>`);
  }

  if (context.persona) {
    parts.push(`<user_persona>`);
    parts.push(`Name: ${context.persona.name}`);
    if (context.persona.description) parts.push(`Description: ${context.persona.description.slice(0, 2000)}`);
    if (context.persona.personality) parts.push(`Personality: ${context.persona.personality}`);
    if (context.persona.backstory) parts.push(`Backstory: ${context.persona.backstory}`);
    if (context.persona.appearance) parts.push(`Appearance: ${context.persona.appearance}`);
    if (context.persona.scenario) parts.push(`Scenario: ${context.persona.scenario}`);
    if (context.persona.personaStats?.enabled && context.persona.personaStats.bars.length > 0) {
      parts.push(`Configured persona stat bars:`);
      for (const bar of context.persona.personaStats.bars) {
        parts.push(`- ${bar.name}: ${bar.value}/${bar.max}`);
      }
    }
    if (context.persona.rpgStats?.enabled) {
      const rpg = context.persona.rpgStats;
      parts.push(`RPG Stats:`);
      parts.push(`- Max HP: ${rpg.hp.max}`);
      if (rpg.attributes.length > 0) {
        parts.push(`Attributes:`);
        for (const attr of rpg.attributes) {
          parts.push(`- ${attr.name}: ${attr.value}`);
        }
      }
    }
    parts.push(`</user_persona>`);
  }

  parts.push(`</lore>`);
  return parts.join("\n");
}

/**
 * Build agent-specific context blocks (sprites, backgrounds, source material, etc.)
 * that go into the system message after lore.
 */
function buildAgentExtras(context: AgentContext, agentTypes: string[] = []): string {
  const parts: string[] = [];

  const escapeXml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  // Card Evolution Auditor needs the FULL character card (not just description)
  // so it can emit exact-match oldText edits. Gated on agent type because
  // forwarding every field would bloat context for agents that don't need it.
  if (agentTypes.includes("card-evolution-auditor") && context.characters.length > 0) {
    parts.push(`<character_cards>`);
    for (const char of context.characters) {
      parts.push(`<character id="${escapeXml(char.id)}" name="${escapeXml(char.name)}">`);
      if (char.description) parts.push(`<description>${escapeXml(char.description)}</description>`);
      if (char.personality) parts.push(`<personality>${escapeXml(char.personality)}</personality>`);
      if (char.scenario) parts.push(`<scenario>${escapeXml(char.scenario)}</scenario>`);
      if (char.backstory) parts.push(`<backstory>${escapeXml(char.backstory)}</backstory>`);
      if (char.appearance) parts.push(`<appearance>${escapeXml(char.appearance)}</appearance>`);
      if (char.firstMes) parts.push(`<first_mes>${escapeXml(char.firstMes)}</first_mes>`);
      if (char.mesExample) parts.push(`<mes_example>${escapeXml(char.mesExample)}</mes_example>`);
      if (char.creatorNotes) parts.push(`<creator_notes>${escapeXml(char.creatorNotes)}</creator_notes>`);
      if (char.systemPrompt) parts.push(`<system_prompt>${escapeXml(char.systemPrompt)}</system_prompt>`);
      if (char.postHistoryInstructions)
        parts.push(`<post_history_instructions>${escapeXml(char.postHistoryInstructions)}</post_history_instructions>`);
      parts.push(`</character>`);
    }
    parts.push(`</character_cards>`);
  }

  if (context.gameState) {
    parts.push(`<current_game_state>`);
    parts.push(JSON.stringify(context.gameState));
    parts.push(`</current_game_state>`);
  }

  if (context.memory._availableSprites) {
    const sprites = context.memory._availableSprites as Array<{
      characterId: string;
      characterName: string;
      expressions: string[];
    }>;
    parts.push(`<available_sprites>`);
    for (const char of sprites) {
      parts.push(`${char.characterName} (${char.characterId}): ${char.expressions.join(", ")}`);
    }
    parts.push(`</available_sprites>`);
  }

  if (context.memory._availableBackgrounds) {
    const bgs = context.memory._availableBackgrounds as Array<{
      filename: string;
      originalName?: string | null;
      tags: string[];
    }>;
    parts.push(`<available_backgrounds>`);
    for (const bg of bgs) {
      const label = bg.originalName ? `${bg.filename} (${bg.originalName})` : bg.filename;
      const tagStr = bg.tags.length > 0 ? ` [tags: ${bg.tags.join(", ")}]` : "";
      parts.push(`- ${label}${tagStr}`);
    }
    parts.push(`</available_backgrounds>`);
    if (context.memory._currentBackground) {
      parts.push(`<current_background>${context.memory._currentBackground}</current_background>`);
    }
  }

  if (context.memory._existingLorebookEntries) {
    const rawEntries = context.memory._existingLorebookEntries as Array<
      string | { name?: string; keys?: string[]; locked?: boolean }
    >;
    const entries = rawEntries
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;

        const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "Unnamed";
        const keys = Array.isArray(entry.keys) ? entry.keys.filter((key) => typeof key === "string") : [];
        const keyText = keys.length > 0 ? ` | keys: ${keys.join(", ")}` : "";
        const lockedText = entry.locked === true ? " | locked" : "";
        return `- ${name}${keyText}${lockedText}`;
      })
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

    if (entries.length > 0) {
      parts.push(`<existing_entries>`);
      parts.push(entries.join("\n"));
      parts.push(`</existing_entries>`);
    }
  }

  if (context.chatSummary) {
    parts.push(`<chat_summary>`);
    parts.push(context.chatSummary);
    parts.push(`</chat_summary>`);
  }

  if (context.memory._sourceMaterial) {
    parts.push(`<source_material>`);
    parts.push(context.memory._sourceMaterial as string);
    parts.push(`</source_material>`);
  }

  if (context.memory._chunkInfo) {
    const info = context.memory._chunkInfo as { current: number; total: number };
    parts.push(
      `<chunk_info>Chunk ${info.current} of ${info.total} — extract relevant information from this chunk.</chunk_info>`,
    );
  }

  if (context.memory._previousExtractions) {
    const extractions = context.memory._previousExtractions as string[];
    parts.push(`<previous_extractions>`);
    parts.push(
      `The following relevant excerpts were extracted from prior chunks of the same source material. Consolidate them into a single, coherent summary along with any new relevant information from the current chunk.`,
    );
    for (let i = 0; i < extractions.length; i++) {
      parts.push(`\n--- Chunk ${i + 1} ---`);
      parts.push(extractions[i]!);
    }
    parts.push(`</previous_extractions>`);
  }

  if (context.memory._knowledgeRetrievalMaterial) {
    parts.push(`<knowledge_material>`);
    parts.push(context.memory._knowledgeRetrievalMaterial as string);
    parts.push(`</knowledge_material>`);
  }

  if (context.memory._connectedDevices) {
    const devices = context.memory._connectedDevices as Array<{ name: string; index: number; capabilities: string[] }>;
    parts.push(`<connected_devices>`);
    for (const d of devices) {
      parts.push(`- ${d.name} (index ${d.index}): ${d.capabilities.join(", ")}`);
    }
    parts.push(`</connected_devices>`);
  }

  if (context.memory._lastCyoaChoices) {
    const lastChoices = context.memory._lastCyoaChoices as Array<{ label: string; text: string }>;
    parts.push(`<previous_cyoa_choices>`);
    parts.push(
      `These are the choices you generated last time. Do NOT repeat them — provide fresh, meaningfully different options.`,
    );
    for (const c of lastChoices) {
      parts.push(`- ${c.label}: ${c.text}`);
    }
    parts.push(`</previous_cyoa_choices>`);
  }

  if (context.memory._secretPlotState) {
    parts.push(`<secret_plot_state>`);
    parts.push(JSON.stringify(context.memory._secretPlotState));
    parts.push(`</secret_plot_state>`);
  }

  return parts.join("\n");
}

/** Map agent type → its primary result type. */
const AGENT_RESULT_TYPE_MAP: Record<string, AgentResultType> = {
  "world-state": "game_state_update",
  "prose-guardian": "context_injection",
  continuity: "continuity_check",
  expression: "sprite_change",
  "echo-chamber": "echo_message",
  director: "director_event",
  quest: "quest_update",
  illustrator: "image_prompt",
  "lorebook-keeper": "lorebook_update",
  "card-evolution-auditor": "character_card_update",
  "prompt-reviewer": "prompt_review",
  combat: "game_state_update",
  background: "background_change",
  "character-tracker": "character_tracker_update",
  "persona-stats": "persona_stats_update",
  "custom-tracker": "custom_tracker_update",
  "chat-summary": "chat_summary",
  spotify: "spotify_control",
  editor: "text_rewrite",
  "knowledge-retrieval": "context_injection",
  haptic: "haptic_command",
  cyoa: "cyoa_choices",
  "secret-plot-driver": "secret_plot",
};

/** Agents that return structured JSON. */
const JSON_AGENTS = new Set([
  "world-state",
  "continuity",
  "expression",
  "echo-chamber",
  "quest",
  "illustrator",
  "lorebook-keeper",
  "card-evolution-auditor",
  "prompt-reviewer",
  "combat",
  "background",
  "character-tracker",
  "persona-stats",
  "custom-tracker",
  "chat-summary",
  "spotify",
  "editor",
  "haptic",
  "cyoa",
  "secret-plot-driver",
]);

/**
 * Parse the raw LLM response into a typed result.
 */
function parseAgentResponse(agentType: string, responseText: string): { type: AgentResultType; data: unknown } {
  const resultType = AGENT_RESULT_TYPE_MAP[agentType] ?? "context_injection";

  if (JSON_AGENTS.has(agentType)) {
    try {
      const jsonStr = extractJson(responseText);
      const data = JSON.parse(jsonStr);
      return { type: resultType, data };
    } catch {
      return { type: resultType, data: { raw: responseText, parseError: true } };
    }
  }

  // Text-based agents (prose-guardian, director)
  return { type: resultType, data: { text: responseText } };
}

/** Extract JSON from a response that may contain markdown fences. */
function extractJson(text: string): string {
  // Try markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) text = fenceMatch[1]!.trim();
  else {
    // Try to find a bare JSON object or array
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) text = jsonMatch[1]!;
  }

  // Repair common LLM JSON issues
  text = repairJson(text);
  return text;
}

/** Fix common LLM JSON mistakes: trailing commas, comments, ellipsis placeholders. */
function repairJson(str: string): string {
  return str
    .replace(/\/\/[^\n]*/g, "") // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove multi-line comments
    .replace(/,\s*([\]\}])/g, "$1") // remove trailing commas before ] or }
    .replace(/\.\.\.[^"\n]*/g, ""); // remove ... continuations/placeholders
}
