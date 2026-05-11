export type AgentRunIntervalMeta = {
  label: string;
  unit: string;
  help: string;
  defaultValue: number;
  max: number;
};

export const EVERY_RUN_LABEL = "Every run";

export function getAgentRunIntervalMeta(agentType: string, isBuiltIn = true): AgentRunIntervalMeta | null {
  switch (agentType) {
    case "director":
      return {
        label: "Run Interval",
        unit: "assistant messages",
        help: "How many assistant messages should pass before the Narrative Director jumps in again. Higher values make it less aggressive.",
        defaultValue: 5,
        max: 100,
      };
    case "lorebook-keeper":
      return {
        label: "Run Interval",
        unit: "assistant messages",
        help: "How many assistant messages should pass between Lorebook Keeper updates.",
        defaultValue: 8,
        max: 100,
      };
    case "card-evolution-auditor":
      return {
        label: "Run Interval",
        unit: "assistant messages",
        help: "How many assistant messages should pass between Card Evolution Auditor checks.",
        defaultValue: 8,
        max: 100,
      };
    case "chat-summary":
      return {
        label: "Triggers After",
        unit: "user messages",
        help: "How many user messages should pass before the Automated Chat Summary updates again.",
        defaultValue: 5,
        max: 200,
      };
    default:
      if (!isBuiltIn) {
        return {
          label: "Trigger Cadence",
          unit: "user messages",
          help: "How many user messages should pass since this custom agent last ran before it triggers again. Set to 1 to run whenever its phase runs.",
          defaultValue: 1,
          max: 200,
        };
      }
      return null;
  }
}

export function getCadenceInputValue(value: number | ""): string {
  return value === 1 ? EVERY_RUN_LABEL : String(value);
}

export function parseOptionalCadenceInputValue(value: string, max: number): number | "" {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (EVERY_RUN_LABEL.toLowerCase().startsWith(trimmed.toLowerCase())) return 1;

  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : 1;
}

export function parseCadenceInputValue(value: string, fallback: number, max: number): number {
  const parsed = parseOptionalCadenceInputValue(value, max);
  return parsed === "" ? fallback : parsed;
}

export function stepCadenceValue(value: number | "", delta: number, max: number): number {
  const current = value === "" ? 1 : value;
  return Math.max(1, Math.min(max, current + delta));
}
