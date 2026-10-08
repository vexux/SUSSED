export type AppView = "home" | "lobby" | "starting" | "question";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type RoomStatus = "lobby" | "starting";
export type GamePhase =
  | "question"
  | "answer-submission"
  | "reveal"
  | "voting"
  | "results"
  | "finished";

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
  players: LobbyPlayer[];
}

export interface GameQuestion {
  id: string;
  text: string;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  question: GameQuestion;
}

export interface AppState {
  currentView: AppView;
  connectionStatus: ConnectionStatus;
  playerName: string;
  localPlayerId: string | null;
  roomCode: string | null;
  lobby: LobbyState | null;
  game: GameState | null;
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
