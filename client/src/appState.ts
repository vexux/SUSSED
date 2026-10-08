export type AppView = "home" | "lobby";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

export interface LobbyState {
  roomCode: string;
  playerCount: number;
  players: LobbyPlayer[];
}

export interface AppState {
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  playerName: string;
  localPlayerId: string | null;
  roomCode: string | null;
  lobby: LobbyState | null;
  errorMessage: string | null;
  isBusy: boolean;
}

export function createInitialAppState(): AppState {
  return {
    currentView: "home",
    connectionStatus: "connecting",
    playerName: "",
    localPlayerId: null,
    roomCode: null,
    lobby: null,
    errorMessage: null,
    isBusy: false,
  };
}
