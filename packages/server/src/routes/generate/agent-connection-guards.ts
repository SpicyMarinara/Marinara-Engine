import { LOCAL_SIDECAR_CONNECTION_ID } from "@marinara-engine/shared";

export type AgentConnectionWarning = {
  code: "local_sidecar_unavailable" | "default_agent_connection_active";
  severity: "warning";
  message: string;
  agentNames: string[];
  fallbackPrevented?: true;
  connectionName?: string;
  model?: string;
};

export function isLocalSidecarConnectionId(connectionId: unknown): boolean {
  return connectionId === LOCAL_SIDECAR_CONNECTION_ID;
}

function formatAgentNameList(agentNames: string[]): string {
  if (agentNames.length === 0) return "Agent";
  if (agentNames.length === 1) return agentNames[0]!;
  return `${agentNames.slice(0, -1).join(", ")} and ${agentNames.at(-1)}`;
}

export function buildLocalSidecarUnavailableWarning(agentNames: string[]): AgentConnectionWarning {
  const normalizedNames = agentNames.length > 0 ? agentNames : ["Agent"];
  const agentList = formatAgentNameList(normalizedNames);
  const noun = normalizedNames.length === 1 ? "this agent" : "these agents";

  return {
    code: "local_sidecar_unavailable",
    severity: "warning",
    agentNames: normalizedNames,
    fallbackPrevented: true,
    message: `${agentList} requested Local Model, but the local sidecar is unavailable. Marinara skipped ${noun} instead of falling back to a paid API connection.`,
  };
}

export function buildDefaultAgentConnectionWarning(args: {
  agentNames: string[];
  connectionName: string;
  model: string;
}): AgentConnectionWarning {
  const normalizedNames = args.agentNames.length > 0 ? args.agentNames : ["Agent"];
  const agentList = formatAgentNameList(normalizedNames);
  const noun = normalizedNames.length === 1 ? "agent is" : "agents are";

  return {
    code: "default_agent_connection_active",
    severity: "warning",
    agentNames: normalizedNames,
    connectionName: args.connectionName,
    model: args.model,
    message: `${agentList} ${noun} using the default agent connection "${args.connectionName}" (${args.model}). If this is a paid API model, agent calls may bill that provider.`,
  };
}
