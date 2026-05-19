export interface SpotifyToolAvailabilityRequestInput {
  enableChatTools: boolean;
  hasChatToolFilter: boolean;
  chatResolvedToolNames: Iterable<string>;
  agentResolvedToolNameGroups: Iterable<Iterable<string>>;
  spotifyToolNames: ReadonlySet<string>;
}

function containsSpotifyTool(names: Iterable<string>, spotifyToolNames: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (spotifyToolNames.has(name)) return true;
  }
  return false;
}

export function resolveSpotifyToolAvailabilityRequest(input: SpotifyToolAvailabilityRequestInput) {
  const chatExplicitlyAllowsSpotify =
    input.enableChatTools &&
    input.hasChatToolFilter &&
    containsSpotifyTool(input.chatResolvedToolNames, input.spotifyToolNames);
  let anyAgentAllowsSpotify = false;

  for (const names of input.agentResolvedToolNameGroups) {
    if (containsSpotifyTool(names, input.spotifyToolNames)) {
      anyAgentAllowsSpotify = true;
      break;
    }
  }

  const needsSpotifyCredentials = chatExplicitlyAllowsSpotify || anyAgentAllowsSpotify;

  return {
    chatExplicitlyAllowsSpotify,
    anyAgentAllowsSpotify,
    needsSpotifyCredentials,
    shouldLogUnavailableToolOmission: needsSpotifyCredentials,
  };
}
