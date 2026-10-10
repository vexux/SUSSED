export type AppView = "home" | "lobby" | "starting" | "game";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type RoomStatus = "lobby" | "starting";

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
}

export interface LobbyState {
  roomCode: string;
  playerCount: number;
  status: RoomStatus;
  selectedGameId: string;
  selectedGame: LobbyGame;
  availableGames: LobbyGame[];
  players: LobbyPlayer[];
}

export interface LobbyGame {
  id: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface GameParticipant {
  id: string;
  name: string;
}

export interface GameSessionState {
  roomCode: string;
  sessionId: string;
  gameId: string;
  displayName: string;
  status: "active" | "finished";
  players: GameParticipant[];
  state: unknown;
}

export interface AppState {
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  playerName: string;
  localPlayerId: string | null;
  roomCode: string | null;
  lobby: LobbyState | null;
  game: GameSessionState | null;
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
    game: null,
    errorMessage: null,
    isBusy: false,
  };
}
