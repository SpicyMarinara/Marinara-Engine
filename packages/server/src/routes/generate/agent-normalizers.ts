import type { AgentInjection } from "../../services/agents/agent-pipeline.js";

export type SecretPlotDirection = { direction: string; fulfilled?: boolean };

export function normalizeContextInjections(raw: unknown): AgentInjection[] {
  if (!Array.isArray(raw)) return [];
  const normalized: AgentInjection[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) normalized.push({ agentType: "prose-guardian", text });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { agentType?: unknown; agentName?: unknown; text?: unknown };
    if (typeof candidate.agentType !== "string" || typeof candidate.text !== "string") continue;
    const text = candidate.text.trim();
    if (text) {
      normalized.push({
        agentType: candidate.agentType,
        agentName: typeof candidate.agentName === "string" ? candidate.agentName : undefined,
        text,
      });
    }
  }
  return normalized;
}

export function normalizeSecretPlotSceneDirections(raw: unknown): SecretPlotDirection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string") {
      const direction = entry.trim();
      return direction ? [{ direction, fulfilled: false }] : [];
    }
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { direction?: unknown; fulfilled?: unknown };
    if (typeof candidate.direction !== "string") return [];
    const direction = candidate.direction.trim();
    return direction ? [{ direction, fulfilled: candidate.fulfilled === true }] : [];
  });
}

export function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const text = entry.trim();
    return text ? [text] : [];
  });
}
