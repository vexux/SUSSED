export interface SocketConfiguration {
  serverUrl: string | null;
  errorMessage: string | null;
}

export function resolveSocketConfiguration(
  configuredServerUrl: string | undefined,
  isProduction: boolean,
): SocketConfiguration {
  const serverUrl = configuredServerUrl?.trim();
  if (serverUrl) {
    return { serverUrl, errorMessage: null };
  }
  if (isProduction) {
    return {
      serverUrl: null,
      errorMessage: "The game server address is not configured. Set VITE_SERVER_URL and rebuild the client.",
    };
  }
  return { serverUrl: "http://localhost:3000", errorMessage: null };
}
