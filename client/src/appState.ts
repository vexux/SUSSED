export type AppView = "home" | "game-selection" | "lobby" | "starting" | "game";
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
  maxPlayers?: number;
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
  resultsReminderSessionId: string | null;
  isSendingResultsReminder: boolean;
  resultsReminderFeedback: string | null;
}

export const LANDING_TAGLINES = [
  "Gather your friends. Ruin their self-esteem.",
  "Create a room. Expose your friends.",
  "Join your friends. Question your friendships.",
  "Your friends are liars. Prove it.",
  "One room. Zero dignity. Questionable friendships.",
  "Bring your friends. Leave with evidence.",
  "Create a room and discover who's the biggest fraud.",
  "Think you know your friends? That's adorable.",
  "Invite your friends. Find out who's confidently stupid.",
  "A party game for people who should not be trusted.",
  "Lie, vote, betray. It's called friendship.",
  "Make a room. Make enemies.",
  "Your group chat, but with consequences.",
  "Prove your friends are idiots. Or prove them right.",
  "Bad answers. Worse friends. Excellent entertainment.",
  "Trust nobody. Especially the funny one.",
  "Friendship is temporary. The scoreboard is forever.",
  "Create a room. Let the accusations begin.",
  "Finally, a way to weaponize your friend group's stupidity.",
  "Come for the games. Stay for the allegations.",
  "Create a room. Question your friendships.",
  "A party game for people with questionable friends.",
  "Your friends are liars. Your votes are evidence.",
  "Gather your friends. Trust absolutely none of them.",
  "One room, multiple liars, questionable friendships.",
  "Think you're funny? Your friends will be the judge.",
  "Expose the frauds hiding in your friend group.",
  "Bad answers. Worse friends. Excellent entertainment.",
] as const;

export function createInitialAppState(): AppState {
  return {
    currentView: "home",
    theme: readThemePreference(),
    connectionStatus: "connecting",
    playerName: "",
    landingTagline: LANDING_TAGLINES[Math.floor(Math.random() * LANDING_TAGLINES.length)],
    localPlayerId: null,
    roomCode: null,
    lobby: null,
    game: null,
    errorMessage: null,
    errorCode: null,
    isBusy: false,
    availableGames: [],
    pendingGameId: null,
    resultsReminderSessionId: null,
    isSendingResultsReminder: false,
    resultsReminderFeedback: null,
  };
}
