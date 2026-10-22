export type AppView = "home" | "game-selection" | "public-rooms" | "lobby" | "starting" | "game";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type RoomStatus = "lobby" | "starting";
export type ThemePreference = "dark" | "light";

export const THEME_STORAGE_KEY = "sussed-theme";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): ThemeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readThemePreference(
  storage: ThemeStorage | undefined = getBrowserStorage(),
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function persistThemePreference(
  theme: ThemePreference,
  storage: ThemeStorage | undefined = getBrowserStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme choice still applies for this page when storage is unavailable.
  }
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  isInGame: boolean;
}

export interface LobbyState {
  roomCode: string;
  revision: number;
  playerCount: number;
  readinessStatus: "insufficient-players" | "waiting-for-ready" | "ready" | "starting";
  status: RoomStatus;
  visibility: "public" | "private";
  maxPlayers: number;
  selectedGameId: string;
  selectedRoundCount: 5 | 7 | 10;
  selectedGame: LobbyGame;
  reminderSessionId: string | null;
  availableGames: LobbyGame[];
  players: LobbyPlayer[];
}

export interface LobbyGame {
  id: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  supportsRoundSelection?: boolean;
}

export interface PublicRoom {
  roomId: string;
  hostName: string;
  gameId: string;
  gameName: string;
  gameDescription: string;
  playerCount: number;
  maxPlayers: number;
  status: "lobby";
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
  theme: ThemePreference;
  connectionStatus: ConnectionStatus;
  playerName: string;
  nameEntryError: string | null;
  pendingPublicRoomId: string | null;
  joinRoomCode: string;
  invitationMessage: string | null;
  isInvitationBusy: boolean;
  isInvitationDialogOpen: boolean;
  invitationUrl: string | null;
  invitationQrDataUrl: string | null;
  isInvitationQrVisible: boolean;
  roomCodeCopied: boolean;
  landingTagline: string;
  localPlayerId: string | null;
  roomCode: string | null;
  lobby: LobbyState | null;
  game: GameSessionState | null;
  errorMessage: string | null;
  errorCode: string | null;
  isBusy: boolean;
  availableGames: LobbyGame[];
  pendingGameId: string | null;
  pendingRoomVisibility: "public" | "private";
  pendingKickPlayerId: string | null;
  pendingHostTransferId: string | null;
  selectedPlayerId: string | null;
  kickFeedback: string | null;
  invitationFeedback: string | null;
  publicRooms: PublicRoom[];
  isLoadingPublicRooms: boolean;
  publicRoomsError: string | null;
  resultsReminderSessionId: string | null;
  isSendingResultsReminder: boolean;
  resultsReminderFeedback: string | null;
}

export const LANDING_TAGLINE = "Gather your friends. Ruin their self-esteem.";

export function createInitialAppState(): AppState {
  return {
    currentView: "home",
    theme: readThemePreference(),
    connectionStatus: "connecting",
    playerName: "",
    nameEntryError: null,
    pendingPublicRoomId: null,
    joinRoomCode: "",
    invitationMessage: null,
    isInvitationBusy: false,
    isInvitationDialogOpen: false,
    invitationUrl: null,
    invitationQrDataUrl: null,
    isInvitationQrVisible: false,
    roomCodeCopied: false,
    landingTagline: LANDING_TAGLINE,
    localPlayerId: null,
    roomCode: null,
    lobby: null,
    game: null,
    errorMessage: null,
    errorCode: null,
    isBusy: false,
    availableGames: [],
    pendingGameId: null,
    pendingRoomVisibility: "private",
    pendingKickPlayerId: null,
    pendingHostTransferId: null,
    selectedPlayerId: null,
    kickFeedback: null,
    invitationFeedback: null,
    publicRooms: [],
    isLoadingPublicRooms: false,
    publicRoomsError: null,
    resultsReminderSessionId: null,
    isSendingResultsReminder: false,
    resultsReminderFeedback: null,
  };
}
