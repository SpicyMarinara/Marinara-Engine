import { useCallback } from "react";
import { useAgentStore } from "../../../stores/agent.store";
import { useChatStore } from "../../../stores/chat.store";
import { useGenerate } from "../../../hooks/use-generate";
import { TRACKER_AGENT_TYPE_IDS } from "../lib/tracker-panel.constants";

export function useTrackerRerun({
  activeChatId,
  enabledAgentTypes,
  flushPatch,
  gameStateRefreshing,
}: {
  activeChatId: string | null;
  enabledAgentTypes: Set<string>;
  flushPatch: () => Promise<void>;
  gameStateRefreshing: boolean;
}) {
  const streamingChatId = useChatStore((s) => s.streamingChatId);
  const isStreamingGlobal = useChatStore((s) => s.isStreaming);
  const isAgentProcessing = useAgentStore((s) => s.isProcessing);
  const { retryAgents } = useGenerate();
  const isStreaming = isStreamingGlobal && streamingChatId === activeChatId;
  const trackerRetryBusy = isAgentProcessing || isStreaming || gameStateRefreshing;

  const rerunTracker = useCallback(
    async (agentType: string) => {
      if (
        !activeChatId ||
        trackerRetryBusy ||
        !TRACKER_AGENT_TYPE_IDS.has(agentType) ||
        !enabledAgentTypes.has(agentType)
      ) {
        return;
      }
      try {
        await flushPatch();
      } catch {
        return;
      }
      await retryAgents(activeChatId, [agentType]);
    },
    [activeChatId, enabledAgentTypes, flushPatch, retryAgents, trackerRetryBusy],
  );

  return {
    rerunTracker,
    trackerRetryBusy,
  };
}
