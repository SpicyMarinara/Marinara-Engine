export type ConnectionProviderLike = {
  provider?: string | null;
};

export function isLanguageGenerationConnection(connection: ConnectionProviderLike): boolean {
  return connection.provider !== "image_generation";
}

export function filterLanguageGenerationConnections<T extends ConnectionProviderLike>(
  connections: readonly T[] | null | undefined,
): T[] {
  return (connections ?? []).filter(isLanguageGenerationConnection);
}
