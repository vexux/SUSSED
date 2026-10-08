export type AppView = "home" | "lobby" | "game";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface AppState {
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  roomCode: string | null;
}

export function createInitialAppState(): AppState {
  return {
    currentView: "home",
    connectionStatus: "connecting",
    roomCode: null,
  };
}
