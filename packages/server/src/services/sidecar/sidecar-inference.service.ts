// ──────────────────────────────────────────────
// Sidecar Local Model — Inference Service
//
// Talks to a spawned llama-server subprocess via
// its OpenAI-compatible localhost HTTP API.
// ──────────────────────────────────────────────

import { randomUUID } from "crypto";
import type { SceneAnalysis } from "@marinara-engine/shared";
import { sanitizeApiError } from "../llm/base-provider.js";
import { sidecarModelService } from "./sidecar-model.service.js";
import { sidecarProcessService } from "./sidecar-process.service.js";
import { resolveSidecarRequestModel } from "./sidecar-request-model.js";

let activeRequests = 0;

function withRequestTracking<T>(fn: () => Promise<T>): Promise<T> {
  activeRequests += 1;
  return fn().finally(() => {
    activeRequests = Math.max(0, activeRequests - 1);
  });
}

export function isInferenceBusy(): boolean {
  return activeRequests > 0;
}

const MAX_OUTPUT_TOKENS = 8192;
const SCENE_ANALYSIS_MAX_TOKENS = 4096;

type SidecarMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SidecarChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: unknown; reasoning_content?: unknown };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timings?: {
    prompt_n?: number;
    prompt_ms?: number;
    predicted_n?: number;
    predicted_ms?: number;
  };
};

type SidecarChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
  }>;
};

function getRequestModel(): string {
  return resolveSidecarRequestModel(
    sidecarModelService.getResolvedBackend(),
    sidecarModelService.getConfiguredModelRef(),
  );
}

export type SidecarTestMessageOutput = {
  content: string;
  reasoning: string;
  output: string;
  nonce: string;
  nonceVerified: boolean;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  timings: {
    promptTokens: number | null;
    promptMs: number | null;
    predictedTokens: number | null;
    predictedMs: number | null;
  };
};

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    let text = "";
    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const part = item as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        text += part.text;
      }
    }
    return text;
  }

  return "";
}

function extractJsonPayload<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced) as T;
    }
    throw new Error("Sidecar returned invalid JSON");
  }
}

function extractChoiceContent(
  choice:
    | {
        delta?: { content?: unknown; reasoning_content?: unknown };
        message?: { content?: unknown; reasoning_content?: unknown };
      }
    | null
    | undefined,
): { content: string; reasoning: string } {
  return {
    content: extractContentText(choice?.delta?.content ?? choice?.message?.content),
    reasoning: extractContentText(choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content),
  };
}

function getRuntimeGenerationSettings() {
  const config = sidecarModelService.getConfig();
  return {
    maxTokens: Math.max(64, Math.floor(config.maxTokens)),
    temperature: Math.min(2, Math.max(0, config.temperature)),
    topP: Math.min(1, Math.max(Number.EPSILON, config.topP)),
    topK: Math.max(0, Math.floor(config.topK)),
  };
}

async function streamChatCompletion(options: {
  messages: SidecarMessage[];
  maxTokens: number;
  responseFormat?: Record<string, unknown>;
}): Promise<string> {
  const baseUrl = await sidecarProcessService.ensureReady();
  const generation = getRuntimeGenerationSettings();
  const maxTokens = Math.min(Math.max(1, Math.floor(options.maxTokens)), generation.maxTokens);
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getRequestModel(),
      stream: true,
      messages: options.messages,
      max_tokens: maxTokens,
      temperature: generation.temperature,
      top_p: generation.topP,
      ...(generation.topK > 0 ? { top_k: generation.topK } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`llama-server error ${response.status}: ${sanitizeApiError(errorText || response.statusText)}`);
  }

  if (!response.body) {
    throw new Error("llama-server returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      const data = trimmed.slice(6);
      if (data === "[DONE]") {
        return content;
      }

      try {
        const parsed = JSON.parse(data) as SidecarChatCompletionChunk;

        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const extracted = extractChoiceContent(choice);
        content += extracted.content;
        reasoning += extracted.reasoning;
      } catch {
        // Ignore malformed chunks and keep streaming.
      }
    }
  }

  if (buffer.trim().startsWith("data: ")) {
    const trailing = buffer.trim().slice(6);
    if (trailing !== "[DONE]") {
      try {
        const parsed = JSON.parse(trailing) as SidecarChatCompletionChunk;
        const choice = parsed.choices?.[0];
        if (choice) {
          const extracted = extractChoiceContent(choice);
          content += extracted.content;
          reasoning += extracted.reasoning;
        }
      } catch {
        // Ignore malformed trailing chunk.
      }
    }
  }

  const trimmedContent = content.trim();
  if (trimmedContent) {
    return trimmedContent;
  }

  return reasoning.trim();
}

export async function runTestMessage(): Promise<SidecarTestMessageOutput> {
  return withRequestTracking(async () => {
    if (!sidecarModelService.getConfiguredModelRef()) {
      throw new Error("Download or select a local model before running a test message.");
    }

    const config = sidecarModelService.getConfig();
    const shouldKeepRunning = config.useForTrackers || config.useForGameScene;
    const baseUrl = await sidecarProcessService.ensureReady({ forceStart: true });
    const nonce = `marinara-${randomUUID().slice(0, 8)}`;

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getRequestModel(),
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "You are a local runtime smoke test. Follow the user's format exactly and do not omit the verification token.",
            },
            {
              role: "user",
              content: `Reply in exactly two lines.
Line 1: TOKEN ${nonce}
Line 2: one short sentence confirming that the local sidecar test succeeded.`,
            },
          ] satisfies SidecarMessage[],
          max_tokens: 48,
          temperature: 0.2,
          top_p: 0.9,
          reasoning_format: "none",
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`llama-server error ${response.status}: ${sanitizeApiError(errorText || response.statusText)}`);
      }

      const payload = (await response.json()) as SidecarChatCompletionResponse;
      const message = payload.choices?.[0]?.message;
      const content = extractContentText(message?.content).trim();
      const reasoning = extractContentText(message?.reasoning_content).trim();
      const output = content || reasoning;
      if (!output) {
        throw new Error("The local sidecar test returned an empty response.");
      }

      const nonceVerified = output.includes(nonce);
      if (!nonceVerified) {
        throw new Error("The local sidecar test returned text, but it did not echo the verification token.");
      }

      return {
        content: content.slice(0, 500),
        reasoning: reasoning.slice(0, 500),
        output: output.slice(0, 500),
        nonce,
        nonceVerified,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? null,
          completionTokens: payload.usage?.completion_tokens ?? null,
          totalTokens: payload.usage?.total_tokens ?? null,
        },
        timings: {
          promptTokens: payload.timings?.prompt_n ?? null,
          promptMs: payload.timings?.prompt_ms ?? null,
          predictedTokens: payload.timings?.predicted_n ?? null,
          predictedMs: payload.timings?.predicted_ms ?? null,
        },
      };
    } finally {
      if (!shouldKeepRunning) {
        await sidecarProcessService.stop().catch(() => {});
      }
    }
  });
}

export async function unloadModel(): Promise<void> {
  await sidecarProcessService.stop();
}

const SCENE_WIDGET_UPDATE_SCHEMA = {
  type: "object" as const,
  properties: {
    widgetId: { type: "string" as const },
    value: { type: ["number", "string"] as const },
    count: { type: "number" as const },
    add: { type: "string" as const },
    remove: { type: "string" as const },
    running: { type: "boolean" as const },
    seconds: { type: "number" as const },
    statName: { type: "string" as const },
  },
  required: ["widgetId"] as const,
  additionalProperties: false as const,
};

const SCENE_ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    background: { type: ["string", "null"] as const },
    music: { type: ["string", "null"] as const },
    ambient: { type: ["string", "null"] as const },
    weather: { type: ["string", "null"] as const },
    timeOfDay: { type: ["string", "null"] as const },
    reputationChanges: {
      type: "array" as const,
      maxItems: 5,
      items: {
        type: "object" as const,
        properties: {
          npcName: { type: "string" as const },
          action: { type: "string" as const },
        },
        required: ["npcName", "action"] as const,
        additionalProperties: false as const,
      },
    },
    widgetUpdates: {
      type: "array" as const,
      maxItems: 20,
      items: SCENE_WIDGET_UPDATE_SCHEMA,
    },
    segmentEffects: {
      type: "array" as const,
      maxItems: 20,
      items: {
        type: "object" as const,
        properties: {
          segment: { type: "number" as const },
          background: { type: ["string", "null"] as const },
          music: { type: ["string", "null"] as const },
          ambient: { type: ["string", "null"] as const },
          sfx: {
            type: "array" as const,
            items: { type: "string" as const },
            maxItems: 3,
          },
          expressions: {
            type: "object" as const,
            additionalProperties: { type: "string" as const },
          },
          widgetUpdates: {
            type: "array" as const,
            items: SCENE_WIDGET_UPDATE_SCHEMA,
            maxItems: 10,
          },
        },
        required: ["segment"] as const,
        additionalProperties: false as const,
      },
    },
  },
  additionalProperties: false as const,
  required: [
    "background",
    "music",
    "ambient",
    "weather",
    "timeOfDay",
    "reputationChanges",
    "widgetUpdates",
    "segmentEffects",
  ] as const,
};

export async function analyzeScene(systemPrompt: string, userPrompt: string): Promise<SceneAnalysis> {
  return withRequestTracking(async () => {
    const raw = await streamChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: SCENE_ANALYSIS_MAX_TOKENS,
      responseFormat: {
        type: "json_schema",
        schema: SCENE_ANALYSIS_SCHEMA,
      },
    });

    return extractJsonPayload<SceneAnalysis>(raw);
  });
}

export async function runTrackerPrompt(systemPrompt: string, userPrompt: string): Promise<string> {
  return withRequestTracking(async () => {
    return await streamChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: MAX_OUTPUT_TOKENS,
    });
  });
}

export async function isInferenceAvailable(): Promise<boolean> {
  if (!sidecarModelService.getConfiguredModelRef() || !sidecarModelService.isEnabled()) {
    return false;
  }

  try {
    await sidecarProcessService.syncForCurrentConfig({ suppressKnownFailure: true, allowRuntimeInstall: false });
  } catch {
    return false;
  }

  return sidecarProcessService.isReady();
}
