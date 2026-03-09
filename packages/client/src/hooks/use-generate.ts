// ──────────────────────────────────────────────
// React Query: Generation (streaming + agent pipeline)
// ──────────────────────────────────────────────
import { useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { useAgentStore } from "../stores/agent.store";
import { useGameStateStore } from "../stores/game-state.store";
import { useUIStore } from "../stores/ui.store";
import { chatKeys } from "./use-chats";
import type { Message } from "@marinara-engine/shared";

/**
 * Hook that handles streaming generation.
 * Returns a function to trigger generation which streams tokens
 * into the chat store, dispatches agent results to the agent store,
 * and invalidates messages on completion.
 */
export function useGenerate() {
  const qc = useQueryClient();
  const { setStreaming, setStreamBuffer, clearStreamBuffer, setRegenerateMessageId, setStreamingCharacterId } =
    useChatStore();
  const {
    setProcessing,
    addResult,
    addThoughtBubble,
    clearThoughtBubbles,
    addEchoMessage,
    clearEchoMessages,
    setFailedAgentTypes,
    clearFailedAgentTypes,
  } = useAgentStore();
  const setGameState = useGameStateStore((s) => s.setGameState);

  const generate = useCallback(
    async (params: {
      chatId: string;
      connectionId: string | null;
      presetId?: string;
      lorebookIds?: string[];
      userMessage?: string;
      regenerateMessageId?: string;
    }) => {
      // Create an AbortController so the stop button can cancel this generation
      const abortController = new AbortController();
      useChatStore.getState().setAbortController(abortController);

      setStreaming(true);
      clearStreamBuffer();
      clearThoughtBubbles();
      clearEchoMessages();
      clearFailedAgentTypes();
      setRegenerateMessageId(params.regenerateMessageId ?? null);

      // Optimistically show the user message in the chat immediately
      if (params.userMessage) {
        const optimisticMsg: Message = {
          id: `__optimistic_${Date.now()}`,
          chatId: params.chatId,
          role: "user",
          characterId: null,
          content: params.userMessage,
          activeSwipeIndex: 0,
          extra: { displayText: null, isGenerated: false, tokenCount: null, generationInfo: null },
          createdAt: new Date().toISOString(),
        };
        qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages(params.chatId), (old) => {
          if (!old) return old;
          const pages = [...old.pages];
          // First page holds newest messages — append to it
          pages[0] = [...(pages[0] ?? []), optimisticMsg];
          return { ...old, pages };
        });
      }

      // ── SillyTavern-style smooth streaming ──
      // Tokens arrive in bursts from the server. Instead of dumping them
      // immediately, we feed them character-by-character from a queue
      // at a controlled rate so the text "types out" smoothly.
      // Uses requestAnimationFrame + adaptive rate for fluid animation.
      const streamingEnabled = useUIStore.getState().enableStreaming;
      let fullBuffer = ""; // What the user sees (or accumulates silently when streaming is off)
      let pendingText = ""; // Tokens waiting to be typed out
      let typingActive = false;
      let typewriterDone: (() => void) | null = null;
      let rafId = 0;

      const MIN_CHARS = 1; // Minimum characters per frame
      const MAX_CHARS = 8; // Maximum characters per frame
      const RAMP_THRESHOLD = 120; // Start ramping up speed at this queue length

      const startTypewriter = () => {
        if (typingActive) return;
        typingActive = true;
        const tick = () => {
          if (pendingText.length === 0) {
            typingActive = false;
            if (typewriterDone) {
              typewriterDone();
              typewriterDone = null;
            }
            return;
          }
          // Adaptive rate: speed up when the queue is long to prevent lag buildup
          const queueLen = pendingText.length;
          const charsThisFrame =
            queueLen > RAMP_THRESHOLD
              ? Math.min(MAX_CHARS, MIN_CHARS + Math.floor((queueLen - RAMP_THRESHOLD) / 10))
              : MIN_CHARS;
          const batch = pendingText.slice(0, charsThisFrame);
          pendingText = pendingText.slice(charsThisFrame);
          fullBuffer += batch;
          setStreamBuffer(fullBuffer);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      };

      try {
        const debugMode = useUIStore.getState().debugMode;

        for await (const event of api.streamEvents("/generate", { ...params, debugMode }, abortController.signal)) {
          switch (event.type) {
            case "token": {
              if (streamingEnabled) {
                pendingText += event.data as string;
                startTypewriter();
              } else {
                // Accumulate silently — don't update the UI until done
                fullBuffer += event.data as string;
              }
              break;
            }

            case "agent_start": {
              setProcessing(true);
              break;
            }

            case "agent_result": {
              const result = event.data as {
                agentType: string;
                agentName: string;
                resultType: string;
                data: unknown;
                success: boolean;
                error: string | null;
                durationMs: number;
              };

              // Store the result
              addResult(result.agentType, {
                agentId: result.agentType,
                agentType: result.agentType,
                type: result.resultType as any,
                data: result.data,
                tokensUsed: 0,
                durationMs: result.durationMs,
                success: result.success,
                error: result.error,
              });

              // Notify on agent failure
              if (!result.success && result.error) {
                toast.error(`Agent "${result.agentName}" failed: ${result.error}`);
              }

              // Display as thought bubble for informational agents
              if (result.success && result.data) {
                const bubble = formatAgentBubble(result.agentType, result.agentName, result.data);
                if (bubble) {
                  addThoughtBubble(result.agentType, result.agentName, bubble);
                }

                // Push echo-chamber reactions to the dedicated echo store
                if (result.agentType === "echo-chamber") {
                  const d = result.data as Record<string, unknown>;
                  const reactions = (d.reactions as Array<{ characterName: string; reaction: string }>) ?? [];
                  for (const r of reactions) {
                    addEchoMessage(r.characterName, r.reaction);
                  }
                }
              }

              // Apply background change
              if (result.success && result.resultType === "background_change" && result.data) {
                const bg = result.data as { chosen?: string | null };
                if (bg.chosen) {
                  useUIStore.getState().setChatBackground(`/api/backgrounds/file/${encodeURIComponent(bg.chosen)}`);
                }
              }
              break;
            }

            case "tool_result": {
              // Already handled by existing tool display — pass through
              break;
            }

            case "debug_prompt": {
              const payload = event.data as { messages?: unknown[]; parameters?: Record<string, unknown> } | unknown[];
              // Handle both old (messages array) and new (object with messages + parameters) formats
              const messages = Array.isArray(payload) ? payload : payload.messages;
              const params = Array.isArray(payload) ? null : payload.parameters;
              console.groupCollapsed(
                "%c[Debug] Prompt sent to model" + (params ? ` — ${params.model} (${params.provider})` : ""),
                "color: #f59e0b; font-weight: bold",
              );
              if (params) {
                console.log("%cParameters", "color: #60a5fa; font-weight: bold", params);
              }
              console.log(
                "%cMessages (%d)",
                "color: #60a5fa; font-weight: bold",
                Array.isArray(messages) ? messages.length : "?",
                messages,
              );
              console.groupEnd();
              break;
            }

            case "debug_usage": {
              const usage = event.data as {
                tokensPrompt: number | null;
                tokensCompletion: number | null;
                tokensTotal: number | null;
                durationMs: number | null;
                finishReason: string | null;
              };
              const parts: string[] = [];
              if (usage.tokensPrompt != null) parts.push(`prompt: ${usage.tokensPrompt.toLocaleString()}`);
              if (usage.tokensCompletion != null) parts.push(`completion: ${usage.tokensCompletion.toLocaleString()}`);
              if (usage.tokensTotal != null) parts.push(`total: ${usage.tokensTotal.toLocaleString()}`);
              if (usage.durationMs != null) parts.push(`${(usage.durationMs / 1000).toFixed(1)}s`);
              if (usage.finishReason) parts.push(`finish: ${usage.finishReason}`);
              const tokenInfo = parts.length > 0 ? parts.join(" · ") : "no usage data";
              console.log("%c[Debug] Token usage — %s", "color: #34d399; font-weight: bold", tokenInfo);
              break;
            }

            case "thinking": {
              // Thinking chunks are streamed from the server but persisted in message extra
              // — the UI picks them up after query invalidation on "done". Nothing to buffer here.
              break;
            }

            case "group_turn": {
              const turn = event.data as { characterId: string; characterName: string; index: number };

              // If this isn't the first character, flush the previous one's content
              if (turn.index > 0) {
                // Drain typewriter for the previous character (only if streaming)
                if (streamingEnabled && (pendingText.length > 0 || typingActive)) {
                  await new Promise<void>((resolve) => {
                    if (pendingText.length === 0 && !typingActive) {
                      resolve();
                      return;
                    }
                    typewriterDone = resolve;
                    startTypewriter();
                  });
                }
                // Pick up the just-saved message from the previous character
                await qc.invalidateQueries({ queryKey: chatKeys.messages(params.chatId) });
                // Reset the stream buffer for the new character
                fullBuffer = "";
                pendingText = "";
                setStreamBuffer("");
              }

              setStreamingCharacterId(turn.characterId);
              break;
            }

            case "game_state": {
              const gs = event.data as Record<string, unknown>;
              setGameState(gs as any);
              break;
            }

            case "game_state_patch": {
              const patch = event.data as Record<string, unknown>;
              const current = useGameStateStore.getState().current;
              if (current) {
                setGameState({ ...current, ...patch } as any);
              }
              break;
            }

            case "chat_summary": {
              // Refresh the chat detail so the summary popover picks up the new value
              const chatId = useChatStore.getState().activeChatId;
              if (chatId) qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
              break;
            }

            case "text_rewrite": {
              // Consistency Editor replaced the message — update displayed text
              const rw = event.data as { editedText?: string; changes?: Array<{ description: string }> };
              if (rw.editedText) {
                if (streamingEnabled) {
                  // Drain any pending typewriter first
                  if (pendingText.length > 0 || typingActive) {
                    cancelAnimationFrame(rafId);
                    pendingText = "";
                    typingActive = false;
                  }
                  setStreamBuffer(rw.editedText);
                }
                fullBuffer = rw.editedText;
              }
              break;
            }

            case "done": {
              setProcessing(false);
              break;
            }

            case "error": {
              const errorMsg = (event.data as string) || "Generation failed";
              toast.error(errorMsg);
              break;
            }

            case "agents_retry_failed": {
              const failedList = event.data as Array<{ agentType: string; error: string | null }>;
              const types = failedList.map((f) => f.agentType);
              setFailedAgentTypes(types);
              toast.error(
                `${types.length} agent${types.length > 1 ? "s" : ""} failed after retry. Use the retry button in the chat header to try again.`,
              );
              break;
            }
          }
        }

        // Wait for typewriter to finish draining pending text (streaming mode only)
        if (streamingEnabled && (pendingText.length > 0 || typingActive)) {
          await new Promise<void>((resolve) => {
            if (pendingText.length === 0 && !typingActive) {
              resolve();
              return;
            }
            typewriterDone = resolve;
            startTypewriter();
          });
        }
        // Final flush — ensure full content is set
        setStreamBuffer(fullBuffer + pendingText);
      } catch (error) {
        // Flush everything instantly on error so user sees what arrived
        cancelAnimationFrame(rafId);
        fullBuffer += pendingText;
        pendingText = "";
        typingActive = false;
        if (fullBuffer) setStreamBuffer(fullBuffer);
        // Abort is intentional — don't log or rethrow
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Generation error:", error);
        throw error;
      } finally {
        // Cancel any pending animation frame to prevent leaks
        cancelAnimationFrame(rafId);
        // Invalidate messages to pick up saved messages / new swipes from backend
        await qc.invalidateQueries({
          queryKey: chatKeys.messages(params.chatId),
        });
        // Wait one frame so React renders the fetched messages before
        // removing the streaming overlay — prevents a visible flash.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        setStreaming(false);
        setProcessing(false);
        clearStreamBuffer();
        setRegenerateMessageId(null);
        setStreamingCharacterId(null);
        useChatStore.getState().setAbortController(null);
      }
    },
    [
      qc,
      setStreaming,
      setStreamBuffer,
      clearStreamBuffer,
      setRegenerateMessageId,
      setStreamingCharacterId,
      setProcessing,
      addResult,
      addThoughtBubble,
      clearThoughtBubbles,
      addEchoMessage,
      clearEchoMessages,
      clearFailedAgentTypes,
      setFailedAgentTypes,
      setGameState,
    ],
  );

  const retryAgents = useCallback(
    async (chatId: string, agentTypes: string[]) => {
      setProcessing(true);
      clearFailedAgentTypes();

      try {
        for await (const event of api.streamEvents("/retry-agents", { chatId, agentTypes })) {
          switch (event.type) {
            case "agent_result": {
              const result = event.data as {
                agentType: string;
                agentName: string;
                resultType: string;
                data: unknown;
                success: boolean;
                error: string | null;
                durationMs: number;
              };
              addResult(result.agentType, {
                agentId: result.agentType,
                agentType: result.agentType,
                type: result.resultType as any,
                data: result.data,
                tokensUsed: 0,
                durationMs: result.durationMs,
                success: result.success,
                error: result.error,
              });
              if (result.success && result.data) {
                const bubble = formatAgentBubble(result.agentType, result.agentName, result.data);
                if (bubble) addThoughtBubble(result.agentType, result.agentName, bubble);
                if (result.agentType === "echo-chamber") {
                  const d = result.data as Record<string, unknown>;
                  const reactions = (d.reactions as Array<{ characterName: string; reaction: string }>) ?? [];
                  for (const r of reactions) addEchoMessage(r.characterName, r.reaction);
                }
                if (result.resultType === "background_change") {
                  const bg = result.data as { chosen?: string | null };
                  if (bg.chosen) {
                    useUIStore.getState().setChatBackground(`/api/backgrounds/file/${encodeURIComponent(bg.chosen)}`);
                  }
                }
              }
              if (!result.success && result.error) {
                toast.error(`Agent "${result.agentName}" failed: ${result.error}`);
              }
              break;
            }
            case "game_state": {
              setGameState(event.data as any);
              break;
            }
            case "game_state_patch": {
              const patch = event.data as Record<string, unknown>;
              const current = useGameStateStore.getState().current;
              if (current) setGameState({ ...current, ...patch } as any);
              break;
            }
            case "error": {
              toast.error((event.data as string) || "Agent retry failed");
              break;
            }
            case "done": {
              break;
            }
          }
        }
        toast.success("Agent retry completed");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const msg = error instanceof Error ? error.message : "Agent retry failed";
        toast.error(msg);
      } finally {
        setProcessing(false);
      }
    },
    [addResult, addThoughtBubble, addEchoMessage, clearFailedAgentTypes, setProcessing, setGameState],
  );

  return { generate, retryAgents };
}

/**
 * Format agent result data into a human-readable thought bubble string.
 * Returns null if the result shouldn't generate a bubble.
 */
function formatAgentBubble(agentType: string, agentName: string, data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  switch (agentType) {
    case "continuity": {
      const issues = (d.issues as any[]) ?? [];
      if (!issues.length) return null;
      return issues.map((i: any) => `${i.severity === "error" ? "🔴" : "🟡"} ${i.description}`).join("\n");
    }

    case "prompt-reviewer": {
      const issues = (d.issues as any[]) ?? [];
      if (!issues.length) return `✅ ${d.summary ?? "Prompt looks good"}`;
      return issues
        .map((i: any) => `${i.severity === "error" ? "🔴" : i.severity === "warning" ? "🟡" : "💡"} ${i.description}`)
        .join("\n");
    }

    case "director": {
      const text = d.text as string;
      if (!text || text.includes("No intervention needed")) return null;
      return text;
    }

    case "quest": {
      const updates = (d.updates as any[]) ?? [];
      if (!updates.length) return null;
      return updates.map((u: any) => `${u.action === "complete" ? "✅" : "📜"} ${u.questName}`).join("\n");
    }

    case "expression": {
      const expressions = (d.expressions as any[]) ?? [];
      if (!expressions.length) return null;
      return expressions
        .map((e: any) => {
          const t = e.transition && e.transition !== "crossfade" ? ` (${e.transition})` : "";
          return `🎭 ${e.characterName}: ${e.expression}${t}`;
        })
        .join("\n");
    }

    case "world-state": {
      // Compact summary of what changed
      const parts: string[] = [];
      if (d.location) parts.push(`📍 ${d.location}`);
      if (d.time) parts.push(`🕐 ${d.time}`);
      if (d.weather) parts.push(`🌤 ${d.weather}`);
      if (parts.length === 0) return null;
      return parts.join(" · ");
    }

    case "background": {
      const reason = d.reason as string;
      const chosen = d.chosen as string | null;
      if (!chosen) return null;
      return `🖼️ ${reason || "Background changed"}`;
    }

    case "echo-chamber": {
      const reactions = (d.reactions as any[]) ?? [];
      if (!reactions.length) return null;
      return reactions.map((r: any) => `💬 ${r.characterName}: ${r.reaction}`).join("\n");
    }

    case "spotify": {
      const action = d.action as string;
      if (action === "none") return null;
      const reason = (d.reason as string) ?? "";
      if (action === "play") {
        const trackName = (d.trackName as string) ?? "Unknown track";
        return `🎵 ${trackName}${reason ? ` — ${reason}` : ""}`;
      }
      if (action === "volume") {
        return `🔊 Volume → ${d.volume}%${reason ? ` (${reason})` : ""}`;
      }
      return reason ? `🎵 ${reason}` : null;
    }

    case "prose-guardian": {
      const text = d.text as string;
      if (!text) return null;
      // Show a compact summary — first ~120 chars
      const trimmed = text.trim();
      const preview = trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
      return `✍️ ${preview}`;
    }

    default:
      return null;
  }
}
