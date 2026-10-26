import "./style.css";
import { onIdTokenChanged } from "firebase/auth";
import {
  createInitialAppState,
  persistThemePreference,
  resolveThemePreference,
  resolveAuthEntryView,
  type AppView,
  type GameSessionState,
  type LobbyGame,
  type LobbyState,
  type PublicRoom,
  type ThemePreference,
} from "./appState";
import { socket, socketConfigurationError } from "./socket";
import {
  createAuthService,
  getAuthErrorMessage,
  getAuthRedirectUrl,
  getPasswordResetCode,
  getRecoveryLinkError,
} from "./auth";
import {
  createSocketSessionChangeHandler,
  createSocketTokenRefreshRetry,
} from "./socketAuth";
import { firebaseClient, firebaseConfigurationError } from "./supabase";
import { renderApp } from "./views";
import type {
  AppActions,
  AuthViewState,
  AppNotification,
  PublicProfile,
  SocialViewState,
} from "./views";
import {
  copyText,
  createInvitationQrDataUrl,
  createInvitationUrl,
  normalizeInvitationCode,
  parseInvitationCode,
  preserveInvitationCode,
  shareOrCopyInvitation,
} from "./invitations";
import { validatePlayerName } from "./playerName";
import {
  isPublicRoomJoinable,
  reconcilePublicRooms,
} from "./publicRoomState";
import {
  isFakeAnswerPublicState,
  updateFakeAnswerProgress,
  updateFakeAnswerVoteProgress,
} from "./games/fakeAnswer";
import {
  isBruhWtfPublicState,
  updateBruhSubmissionProgress,
  updateBruhVoteProgress,
} from "./games/bruhWtf";

interface FakeAnswerSubmissionResponse {
  submitted?: boolean;
  voted?: boolean;
  ready?: boolean;
  advanced?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

interface RoomOperationResponse {
  starting?: boolean;
  game?: GameSessionState;
  roomCode?: string;
  lobby?: LobbyState;
  left?: boolean;
  returned?: boolean;
  sent?: number;
  selectedGameId?: string;
  selectedRoundCount?: 5 | 7 | 10;
  error?: {
    code: string;
    message: string;
  };
}

interface GameListResponse {
  games?: LobbyGame[];
  error?: { code: string; message: string };
}

interface PublicRoomsResponse {
  rooms?: PublicRoom[];
  error?: { code: string; message: string };
}

interface SocialOperationResponse {
  profile?: PublicProfile & { handleChangeAvailableAt: string | null };
  profiles?: PublicProfile[];
  friends?: PublicProfile[];
  incomingRequests?: Array<PublicProfile & { requestId: string }>;
  outgoingRequests?: Array<PublicProfile & { requestId: string }>;
  requestId?: string;
  ok?: boolean;
  error?: { code: string; message: string };
}

interface NotificationResponse {
  notifications?: AppNotification[];
  unreadCount?: number;
  hasMore?: boolean;
  ok?: boolean;
  invitationId?: string;
  lobby?: LobbyState;
  error?: { code: string; message: string };
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("The application root element was not found.");
}
const appRoot: HTMLElement = app;

const state = createInitialAppState();
let accountReturnView: AppView = "home";
const invitationCode = parseInvitationCode(window.location.search);
const authService = firebaseClient
  ? createAuthService(
      firebaseClient,
      preserveInvitationCode(
        getAuthRedirectUrl(import.meta.env.VITE_AUTH_REDIRECT_URL, window.location.origin),
        window.location.origin,
        invitationCode,
      ),
    )
  : null;
const recoveryLinkError = getRecoveryLinkError(
  window.location.hash,
  window.location.search,
);
let pendingPasswordResetCode = getPasswordResetCode(
  window.location.search,
  window.location.hash,
);
const authCallbackParameters = new URLSearchParams(window.location.search);
for (const [key, value] of new URLSearchParams(
  window.location.hash.replace(/^#/u, ""),
)) {
  authCallbackParameters.set(key, value);
}
const authViewState: AuthViewState = {
  mode: recoveryLinkError || pendingPasswordResetCode ? "recovery" : "sign-in",
  email: "",
  password: "",
  passwordConfirmation: "",
  userEmail: null as string | null,
  isAuthenticated: false,
  isBusy: false,
  errorMessage: null as string | null,
  statusMessage: null as string | null,
  verificationRequired: false,
  resendAvailableAt: null as number | null,
  hasRecoverySession: false,
  configurationError: firebaseConfigurationError ?? (!firebaseClient
    ? "Account authentication is not configured. Set the Firebase client variables to enable accounts. Guest play remains available."
    : null),
  recoveryError: recoveryLinkError,
};
const socialViewState: SocialViewState = {
  profile: null,
  selectedProfile: null,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  searchMode: "handle",
  searchQuery: "",
  searchResults: [],
  isLoading: false,
  isBusy: false,
  errorMessage: null,
  statusMessage: null,
  friendsTab: "friends",
  requestsTab: "incoming",
  notificationPopoverOpen: false,
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsOffset: 0,
  notificationsHasMore: false,
  notificationsLoading: false,
  notificationsError: null,
  notificationActionBusyId: null,
};
state.currentView = resolveAuthEntryView({
  restored: !firebaseClient,
  hasUser: false,
  isAuthenticated: false,
  requiresEmailVerification: false,
  isRecoveryFlow: Boolean(recoveryLinkError || pendingPasswordResetCode),
});
if (pendingPasswordResetCode) {
  authViewState.isBusy = true;
}
if (!recoveryLinkError && authCallbackParameters.has("error")) {
  authViewState.errorMessage =
    "Google sign-in could not finish. Confirm Google is enabled in Firebase and its redirect URLs are configured.";
}
if (pendingPasswordResetCode && authService) {
  const resetCode = pendingPasswordResetCode;
  void authService.verifyPasswordResetCode(resetCode).then((email) => {
    if (pendingPasswordResetCode !== resetCode) return;
    authViewState.email = email;
    authViewState.hasRecoverySession = true;
    authViewState.statusMessage = "Choose a new password for your account.";
  }).catch((error: unknown) => {
    if (pendingPasswordResetCode !== resetCode) return;
    authViewState.recoveryError = error instanceof Error
      ? error.message
      : getAuthErrorMessage(error);
  }).finally(() => {
    authViewState.isBusy = false;
    render();
  });
} else if (pendingPasswordResetCode) {
  authViewState.isBusy = false;
}
let resendCooldownTimer: ReturnType<typeof setInterval> | null = null;
if (invitationCode.status === "valid") {
  state.joinRoomCode = invitationCode.code;
  state.invitationMessage = "Invitation code ready. Enter your name, then join the room.";
} else if (invitationCode.status === "invalid") {
  state.invitationMessage = "This invitation link has an invalid room code. You can enter a room code manually.";
}
state.connectionStatus = socketConfigurationError
  ? "disconnected"
  : socket.connected
    ? "connected"
    : "connecting";
if (socketConfigurationError) {
  state.errorMessage = socketConfigurationError;
}
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
function applyThemePreference(): void {
  const prefersLight = typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  const systemPreference = prefersLight ? "light" : "dark";
  const resolvedTheme = resolveThemePreference(state.theme, systemPreference);
  document.documentElement.dataset.theme = resolvedTheme;
  if (themeColor) themeColor.content = resolvedTheme === "dark" ? "#17131c" : "#f7f4fa";
}
applyThemePreference();
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: light)");
systemThemeQuery?.addEventListener?.("change", () => {
  if (state.theme !== "system") return;
  applyThemePreference();
});
let fakeAnswerHasSubmitted = false;
let fakeAnswerIsSubmitting = false;
let fakeAnswerErrorMessage: string | null = null;
let fakeAnswerCompletionDraft = "";
let fakeAnswerHasVoted = false;
let fakeAnswerIsVoting = false;
let fakeAnswerSelectedOptionId: string | null = null;
let fakeAnswerVoteError: string | null = null;
let fakeAnswerIsContinuing = false;
let fakeAnswerContinueError: string | null = null;
let fakeAnswerIsReturningToLobby = false;
let fakeAnswerReturnToLobbyError: string | null = null;
let allRoundHistoryOpen = false;
let allRoundHistoryPage = -1;
let fakeAnswerFeedbackDismissedIdentity: string | null = null;
let resultsReminderSuccessTimeout: ReturnType<typeof setTimeout> | null = null;
let invitationFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
let notificationRefreshTimer: ReturnType<typeof setInterval> | null = null;
let playerActionFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
let publicRoomsRequestId = 0;
let bruhAnswerDraft = "";
let bruhIsSubmitting = false;
let bruhSubmitError: string | null = null;
let bruhSelectedOptionId: string | null = null;
let bruhIsVoting = false;
let bruhVoteError: string | null = null;
let bruhIsContinuing = false;
let bruhContinueError: string | null = null;
const retiredGameSessionIds = new Set<string>();
const FACT_OR_CAP_GAME_IDS = new Set(["fact-or-cap", "fact-or-cap-anime"]);

function resetFakeAnswerViewState(): void {
  fakeAnswerHasSubmitted = false;
  fakeAnswerIsSubmitting = false;
  fakeAnswerErrorMessage = null;
  fakeAnswerCompletionDraft = "";
  fakeAnswerHasVoted = false;
  fakeAnswerIsVoting = false;
  fakeAnswerSelectedOptionId = null;
  fakeAnswerVoteError = null;
  fakeAnswerIsContinuing = false;
  fakeAnswerContinueError = null;
  fakeAnswerIsReturningToLobby = false;
  fakeAnswerReturnToLobbyError = null;
  fakeAnswerFeedbackDismissedIdentity = null;
  allRoundHistoryOpen = false;
  allRoundHistoryPage = -1;
  bruhAnswerDraft = "";
  bruhIsSubmitting = false;
  bruhSubmitError = null;
  bruhSelectedOptionId = null;
  bruhIsVoting = false;
  bruhVoteError = null;
  bruhIsContinuing = false;
  bruhContinueError = null;
}

function clearResultsReminderSuccess(): void {
  if (resultsReminderSuccessTimeout) {
    clearTimeout(resultsReminderSuccessTimeout);
    resultsReminderSuccessTimeout = null;
  }
  state.resultsReminderSentSessionId = null;
}

function showResultsReminderSuccess(roomCode: string, sessionId: string): void {
  clearResultsReminderSuccess();
  state.resultsReminderSentSessionId = sessionId;
  resultsReminderSuccessTimeout = setTimeout(() => {
    resultsReminderSuccessTimeout = null;
    if (
      state.currentView !== "lobby" ||
      state.lobby?.roomCode !== roomCode ||
      state.lobby.reminderSessionId !== sessionId
    ) return;
    state.resultsReminderSentSessionId = null;
    render();
  }, 2500);
}

function clearInvitationFeedback(): void {
  if (invitationFeedbackTimeout) {
    clearTimeout(invitationFeedbackTimeout);
    invitationFeedbackTimeout = null;
  }
  state.invitationFeedback = null;
  state.roomCodeCopied = false;
}

function showInvitationFeedback(message: string, roomCodeCopied = false): void {
  clearInvitationFeedback();
  state.invitationFeedback = message;
  state.roomCodeCopied = roomCodeCopied;
  invitationFeedbackTimeout = setTimeout(() => {
    state.invitationFeedback = null;
    state.roomCodeCopied = false;
    invitationFeedbackTimeout = null;
    render();
  }, 2400);
}

function showPlayerActionFeedback(message: string): void {
  clearPlayerActionFeedback();
  state.kickFeedback = message;
  playerActionFeedbackTimeout = setTimeout(() => {
    state.kickFeedback = null;
    playerActionFeedbackTimeout = null;
    render();
  }, 3000);
}

function clearPlayerActionFeedback(): void {
  if (playerActionFeedbackTimeout) {
    clearTimeout(playerActionFeedbackTimeout);
    playerActionFeedbackTimeout = null;
  }
  state.kickFeedback = null;
}

function render(): void {
  if (state.currentView !== "lobby") {
    state.isInvitationDialogOpen = false;
  }
  if (
    state.resultsReminderSentSessionId &&
    (state.currentView !== "lobby" ||
      state.lobby?.reminderSessionId !== state.resultsReminderSentSessionId)
  ) {
    clearResultsReminderSuccess();
  }
  renderApp(appRoot, state, actions, {
    hasSubmitted: fakeAnswerHasSubmitted,
    completionDraft: fakeAnswerCompletionDraft,
    currentPlayerId: state.localPlayerId,
    isSubmitting: fakeAnswerIsSubmitting,
    submissionError: fakeAnswerErrorMessage,
    hasVoted: fakeAnswerHasVoted,
    isVoting: fakeAnswerIsVoting,
    selectedOptionId: fakeAnswerSelectedOptionId,
    voteError: fakeAnswerVoteError,
    isContinuing: fakeAnswerIsContinuing,
    continueError: fakeAnswerContinueError,
    isHost:
      state.lobby?.players.some(
        (player) => player.id === state.localPlayerId && player.isHost,
      ) ?? false,
    isResultsViewer: state.lobby?.players.some(
      (player) => player.id === state.localPlayerId && player.isInGame,
    ) ?? false,
    isReturningToLobby: fakeAnswerIsReturningToLobby,
    returnToLobbyError: fakeAnswerReturnToLobbyError,
    isRoundFeedbackDismissed:
      Boolean(state.game) &&
      isFakeAnswerPublicState(state.game?.state) &&
      fakeAnswerFeedbackDismissedIdentity ===
        `${state.game?.sessionId}:${state.game.state.roundId}`,
    historyOpen: allRoundHistoryOpen,
    historyPage: allRoundHistoryPage,
  }, {
    currentPlayerId: state.localPlayerId,
    answerDraft: bruhAnswerDraft,
    isSubmitting: bruhIsSubmitting,
    submitError: bruhSubmitError,
    selectedOptionId: bruhSelectedOptionId,
    hasVoted: isBruhWtfPublicState(state.game?.state) &&
      state.game.state.phase === "voting" &&
      state.game.state.voteProgress?.some(({ playerId, voted }) => playerId === state.localPlayerId && voted) === true,
    isVoting: bruhIsVoting,
    voteError: bruhVoteError,
    isContinuing: bruhIsContinuing,
    continueError: bruhContinueError,
    isHost: state.lobby?.players.some(
      (player) => player.id === state.localPlayerId && player.isHost,
    ) ?? false,
    isResultsViewer: state.lobby?.players.some(
      (player) => player.id === state.localPlayerId && player.isInGame,
    ) ?? false,
    isReturningToLobby: fakeAnswerIsReturningToLobby,
    returnToLobbyError: fakeAnswerReturnToLobbyError,
    historyOpen: allRoundHistoryOpen,
    historyPage: allRoundHistoryPage,
  }, authViewState, socialViewState);
  document.body.classList.toggle(
    "modal-open",
    appRoot.querySelector(".round-feedback-backdrop, .kick-confirmation-backdrop, .invitation-dialog, .player-detail-dialog[aria-modal='true'], .results-reminder-dialog[open]") !== null,
  );
}

function focusCurrentScreen(): void {
  const target = appRoot.querySelector<HTMLElement>(
    ".lobby-screen h1, .starting-screen > h1, .final-results-screen h1, .question-screen:not(.final-results-screen)",
  );
  if (!target) return;
  target.tabIndex = -1;
  target.focus();
}

function focusPlayerName(id: string): void {
  appRoot.querySelector<HTMLInputElement>(`#${id}`)?.focus();
}

function focusPublicRoomJoin(roomId: string): void {
  const joinButton = Array.from(
    appRoot.querySelectorAll<HTMLButtonElement>(".public-room-join"),
  ).find(
    (button) =>
      button.closest<HTMLElement>(".public-room-card")?.dataset.roomId === roomId &&
      !button.disabled,
  );
  if (joinButton) {
    joinButton.focus();
    return;
  }
  const heading = appRoot.querySelector<HTMLElement>(".public-rooms-screen h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

function requestAvailableGames(): void {
  socket.timeout(5000).emit(
    "list-games",
    (error: Error | null, response?: GameListResponse) => {
      if (error || !response || !Array.isArray(response.games)) return;
      state.availableGames = response.games;
      if (state.lobby) state.lobby.availableGames = response.games;
      render();
    },
  );
}

function applyPublicRoomsResponse(
  requestId: number,
  error: Error | null,
  response?: PublicRoomsResponse,
): void {
  if (requestId !== publicRoomsRequestId || state.currentView !== "public-rooms") return;
  state.isLoadingPublicRooms = false;
  if (error || !response || !Array.isArray(response.rooms)) {
    state.publicRoomsError = response?.error?.message ?? "Public rooms could not be loaded. Try again.";
  } else {
    state.publicRoomsError = null;
    const pendingRoomId = state.pendingPublicRoomId;
    if (reconcilePublicRooms(state, response.rooms) && pendingRoomId) {
      render();
      focusPublicRoomJoin(pendingRoomId);
      return;
    }
  }
  render();
}

function subscribeToPublicRooms(): void {
  state.isLoadingPublicRooms = true;
  state.publicRoomsError = null;
  render();
  const requestId = ++publicRoomsRequestId;
  socket.timeout(5000).emit("subscribe-public-rooms", (error: Error | null, response?: PublicRoomsResponse) =>
    applyPublicRoomsResponse(requestId, error, response));
}

function refreshPublicRooms(): void {
  state.isLoadingPublicRooms = true;
  state.publicRoomsError = null;
  render();
  const requestId = ++publicRoomsRequestId;
  socket.timeout(5000).emit("refresh-public-rooms", (error: Error | null, response?: PublicRoomsResponse) =>
    applyPublicRoomsResponse(requestId, error, response));
}

function unsubscribeFromPublicRooms(): void {
  publicRoomsRequestId += 1;
  if (socket.connected) socket.emit("unsubscribe-public-rooms");
}

function clearPublicRoomSelection(): void {
  state.pendingPublicRoomId = null;
  state.nameEntryError = null;
}

function markPublicRoomUnavailable(roomId: string, message: string): void {
  state.publicRooms = state.publicRooms.filter(({ roomId: candidateId }) => candidateId !== roomId);
  clearPublicRoomSelection();
  state.publicRoomsError = `${message} Refresh the list or choose another room.`;
}

function showOperationError(response: RoomOperationResponse): void {
  state.isBusy = false;
  state.errorCode = response.error?.code ?? null;
  if (
    response.error?.code === "NOT_IN_ROOM" ||
    response.error?.code === "ROOM_NOT_FOUND"
  ) {
    state.currentView = "home";
    state.roomCode = null;
    state.localPlayerId = null;
    state.lobby = null;
    state.game = null;
    resetFakeAnswerViewState();
    state.errorMessage =
      "This room is no longer available. Create a room or join another room to continue.";
    state.errorCode = null;
    render();
    return;
  }
  state.errorMessage =
    response.error?.message ?? "The room operation could not be completed.";
  render();
}

function emitRoomOperation(
  event: string,
  payload: object | undefined,
  onResponse: (response: RoomOperationResponse) => void,
): void {
  const acknowledge = (
    error: Error | null,
    response?: RoomOperationResponse,
  ): void => {
    if (error || !response) {
      showOperationError({
        error: {
          code: "SERVER_TIMEOUT",
          message: "The server did not respond. Please try again.",
        },
      });
      return;
    }
    onResponse(response);
  };

  const timedSocket = socket.timeout(5000);
  if (payload === undefined) {
    timedSocket.emit(event, acknowledge);
  } else {
    timedSocket.emit(event, payload, acknowledge);
  }
}

function fallbackCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("aria-hidden", "true");
  field.tabIndex = -1;
  field.style.position = "fixed";
  field.style.insetInlineStart = "-10000px";
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    field.remove();
  }
  return copied;
}

async function copyInvitationText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  await copyText(text, {
    writeText: clipboard ? (value) => clipboard.writeText(value) : undefined,
    fallbackCopy,
  });
}

function buildCurrentInvitationUrl(roomCode: string): string {
  return createInvitationUrl(
    roomCode,
    window.location.href,
    import.meta.env.VITE_PUBLIC_APP_URL,
  );
}

function runInvitationAction(action: () => Promise<string>, roomCodeCopied = false): void {
  if (state.isBusy || state.isInvitationBusy || !state.lobby) return;
  clearInvitationFeedback();
  state.isInvitationBusy = true;
  state.errorMessage = null;
  state.errorCode = null;
  render();
  void action().then((message) => {
    showInvitationFeedback(message, roomCodeCopied);
  }).catch(() => {
    state.errorMessage = "The invitation could not be copied or shared. Check clipboard or sharing permissions and try again.";
    state.errorCode = "INVITATION_ACTION_FAILED";
  }).finally(() => {
    state.isInvitationBusy = false;
    render();
  });
}

function applyLobbyState(lobby: LobbyState): void {
  if (
    (state.roomCode !== null && lobby.roomCode !== state.roomCode) ||
    (state.lobby?.roomCode === lobby.roomCode &&
      lobby.revision < state.lobby.revision)
  ) {
    return;
  }
  const localPlayer = lobby.players.find((player) => player.id === socket.id);
  if (!localPlayer) {
    return;
  }

  const remainsOnFinishedResults =
    state.currentView === "game" &&
    state.game?.status === "finished" &&
    localPlayer.isInGame;
  const dismissedResultsReminder = state.resultsReminderSessionId !== null;
  const previousReminderSessionId = state.lobby?.reminderSessionId;
  if (previousReminderSessionId !== lobby.reminderSessionId) {
    state.isSendingResultsReminder = false;
    clearResultsReminderSuccess();
  }
  const targetIds = new Set(lobby.players.map(({ id }) => id));
  const pendingPlayerId = state.pendingKickPlayerId ?? state.pendingHostTransferId;
  const pendingPlayer = lobby.players.find(({ id }) => id === pendingPlayerId);
  const invalidatedPlayerActionId =
    pendingPlayerId &&
    (!pendingPlayer ||
      pendingPlayer.isHost ||
      lobby.status !== "lobby" ||
      !localPlayer.isHost)
      ? pendingPlayerId
      : null;
  const invalidatedCardId =
    state.selectedPlayerId && !targetIds.has(state.selectedPlayerId)
      ? state.selectedPlayerId
      : null;
  const previousRoomCode = state.lobby?.roomCode;
  if (previousRoomCode && previousRoomCode !== lobby.roomCode) {
    clearResultsReminderSuccess();
    clearInvitationFeedback();
    clearPlayerActionFeedback();
  }
  if ((lobby.status === "lobby" && !remainsOnFinishedResults) || (lobby.status === "starting" && localPlayer.isInGame === false && state.game?.status === "finished")) {
    if (state.game) {
      retiredGameSessionIds.add(state.game.sessionId);
    }
    state.game = null;
    resetFakeAnswerViewState();
  }
  state.resultsReminderSessionId = null;
  state.currentView =
    remainsOnFinishedResults
      ? "game"
      : lobby.status === "lobby"
        ? "lobby"
        : state.game
          ? "game"
          : "starting";
  state.roomCode = lobby.roomCode;
  state.localPlayerId = localPlayer.id;
  state.playerName = localPlayer.name;
  state.lobby = lobby;
  state.invitationMessage = null;
  if (
    state.pendingKickPlayerId &&
    (!pendingPlayer || pendingPlayer.isHost || lobby.status !== "lobby" || !localPlayer.isHost)
  ) {
    state.pendingKickPlayerId = null;
  }
  if (
    state.pendingHostTransferId &&
    (!pendingPlayer || pendingPlayer.isHost || lobby.status !== "lobby" || !localPlayer.isHost)
  ) {
    state.pendingHostTransferId = null;
  }
  if (invalidatedCardId) {
    state.selectedPlayerId = null;
  }
  if (lobby.status !== "lobby") {
    state.pendingKickPlayerId = null;
    state.pendingHostTransferId = null;
  }
  if (!localPlayer.isHost) {
    state.pendingKickPlayerId = null;
    state.pendingHostTransferId = null;
  }
  state.availableGames = lobby.availableGames;
  state.pendingGameId = null;
  state.errorMessage = null;
  state.errorCode = null;
  state.isBusy = false;
  render();
  if (invalidatedPlayerActionId || invalidatedCardId) {
    focusPlayerCardTrigger(invalidatedPlayerActionId ?? invalidatedCardId ?? "");
  } else if (dismissedResultsReminder) {
    focusCurrentScreen();
  }
}

function focusPlayerCardTrigger(playerId: string): void {
  const cards = Array.from(appRoot.querySelectorAll<HTMLButtonElement>(".player-card"));
  const target = cards
    .find(({ dataset }) => dataset.playerId === playerId)
    ?? cards[0];
  if (target) {
    target.focus();
    return;
  }
  const heading = appRoot.querySelector<HTMLElement>(".lobby-screen h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

function currentFakeAnswerIdentity(): { sessionId: string; roundId: string } | null {
  if (
    !state.game ||
    !FACT_OR_CAP_GAME_IDS.has(state.game.gameId) ||
    !isFakeAnswerPublicState(state.game.state)
  ) {
    return null;
  }
  return {
    sessionId: state.game.sessionId,
    roundId: state.game.state.roundId,
  };
}

function isCurrentFakeAnswerIdentity(identity: {
  sessionId: string;
  roundId: string;
}): boolean {
  return (
    state.game?.sessionId === identity.sessionId &&
    isFakeAnswerPublicState(state.game.state) &&
    state.game.state.roundId === identity.roundId
  );
}

function currentBruhIdentity(): { sessionId: string; roundId: string } | null {
  if (!state.game || state.game.gameId !== "bruh-wtf" || !isBruhWtfPublicState(state.game.state)) return null;
  return { sessionId: state.game.sessionId, roundId: state.game.state.roundId };
}

function isCurrentBruhIdentity(identity: { sessionId: string; roundId: string }): boolean {
  return state.game?.sessionId === identity.sessionId &&
    state.game.gameId === "bruh-wtf" &&
    isBruhWtfPublicState(state.game.state) &&
    state.game.state.roundId === identity.roundId;
}

function recoverFromUnavailableGame(): void {
  state.currentView = "home";
  state.roomCode = null;
  state.localPlayerId = null;
  state.lobby = null;
  state.game = null;
  resetFakeAnswerViewState();
  state.isBusy = false;
  state.errorMessage =
    "This game session is no longer available. Create a room or join another room to continue.";
  state.errorCode = null;
  render();
}

function applyGameState(game: GameSessionState): void {
  if (
    game.roomCode !== state.roomCode ||
    typeof game.sessionId !== "string" ||
    (game.status !== "active" && game.status !== "finished")
  ) {
    return;
  }
  if (
    retiredGameSessionIds.has(game.sessionId) ||
    (state.currentView === "lobby" && state.lobby?.status === "lobby")
  ) {
    return;
  }
  const previousGame = state.game;
  const previousState = previousGame?.state;
  const nextState = game.state;
  const isSubmissionProgressOnly =
    state.currentView === "game" &&
    previousGame?.roomCode === game.roomCode &&
    previousGame.gameId === game.gameId &&
    FACT_OR_CAP_GAME_IDS.has(game.gameId) &&
    isFakeAnswerPublicState(previousState) &&
    isFakeAnswerPublicState(nextState) &&
    previousState.phase === "answer-submission" &&
    nextState.phase === "answer-submission" &&
    previousState.currentRound === nextState.currentRound &&
    previousState.totalRounds === nextState.totalRounds &&
    previousState.playerCount === nextState.playerCount &&
    previousState.prompt?.id === nextState.prompt?.id &&
    previousState.prompt?.text === nextState.prompt?.text &&
    previousState.submissionCount !== nextState.submissionCount &&
    JSON.stringify(previousState.submissionProgress) !==
      JSON.stringify(nextState.submissionProgress);
  const isVoteProgressOnly =
    state.currentView === "game" &&
    previousGame?.roomCode === game.roomCode &&
    previousGame.gameId === game.gameId &&
    FACT_OR_CAP_GAME_IDS.has(game.gameId) &&
    isFakeAnswerPublicState(previousState) &&
    isFakeAnswerPublicState(nextState) &&
    (previousState.phase === "voting" ||
      previousState.phase === "waiting-for-results") &&
    previousState.phase === nextState.phase &&
    previousState.currentRound === nextState.currentRound &&
    previousState.voteCount !== nextState.voteCount &&
    JSON.stringify(previousState.options) === JSON.stringify(nextState.options) &&
    JSON.stringify(previousState.voteProgress) !==
      JSON.stringify(nextState.voteProgress);
  const isBruhSubmissionProgressOnly =
    state.currentView === "game" &&
    previousGame?.roomCode === game.roomCode &&
    previousGame.gameId === game.gameId &&
    game.gameId === "bruh-wtf" &&
    isBruhWtfPublicState(previousState) &&
    isBruhWtfPublicState(nextState) &&
    previousState.phase === "answer-submission" &&
    nextState.phase === "answer-submission" &&
    previousState.roundId === nextState.roundId &&
    previousState.submissionCount !== nextState.submissionCount;
  const isNewGame =
    state.game?.roomCode !== game.roomCode ||
    state.game?.gameId !== game.gameId ||
    state.game?.sessionId !== game.sessionId;
  if (state.game && isNewGame) {
    retiredGameSessionIds.add(state.game.sessionId);
  }
  const isNewRound =
    !isNewGame &&
    ((isFakeAnswerPublicState(previousState) &&
      isFakeAnswerPublicState(nextState) &&
      previousState.currentRound !== nextState.currentRound) ||
      (isBruhWtfPublicState(previousState) &&
        isBruhWtfPublicState(nextState) &&
        previousState.roundId !== nextState.roundId));
  if (isNewGame || isNewRound) {
    resetFakeAnswerViewState();
  }
  state.game = game;
  state.currentView = "game";
  state.errorMessage = null;
  state.errorCode = null;
  state.isBusy = false;
  if (
    isSubmissionProgressOnly &&
    updateFakeAnswerProgress(appRoot, game.state, state.localPlayerId)
  ) {
    return;
  }
  if (
    isBruhSubmissionProgressOnly &&
    updateBruhSubmissionProgress(appRoot, game.state, state.localPlayerId)
  ) {
    return;
  }
  const isBruhVoteProgressOnly =
    state.currentView === "game" &&
    previousGame?.roomCode === game.roomCode &&
    previousGame.gameId === game.gameId &&
    game.gameId === "bruh-wtf" &&
    isBruhWtfPublicState(previousState) &&
    isBruhWtfPublicState(nextState) &&
    previousState.phase === "voting" &&
    nextState.phase === "voting" &&
    previousState.roundId === nextState.roundId &&
    previousState.voteCount !== nextState.voteCount;
  if (
    isBruhVoteProgressOnly &&
    updateBruhVoteProgress(appRoot, game.state, state.localPlayerId)
  ) {
    return;
  }
  if (
    isVoteProgressOnly &&
    updateFakeAnswerVoteProgress(appRoot, game.state)
  ) {
    return;
  }
  render();
}

async function runAuthAction(
  operation: () => Promise<void>,
  onSuccess?: () => void,
): Promise<void> {
  if (!authService || authViewState.isBusy) return;
  authViewState.isBusy = true;
  authViewState.errorMessage = null;
  authViewState.statusMessage = null;
  render();
  try {
    await operation();
    onSuccess?.();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : getAuthErrorMessage(error);
    authViewState.errorMessage = message;
    if (message.toLowerCase().includes("verify your email")) {
      authViewState.verificationRequired = true;
    }
  } finally {
    authViewState.isBusy = false;
    render();
  }
}

function runSocialOperation(
  eventName: string,
  payload: unknown | undefined,
  onSuccess: (response: SocialOperationResponse) => void,
  focusScreenHeading = false,
): void {
  if (!authViewState.isAuthenticated || socialViewState.isBusy) return;
  socialViewState.isBusy = true;
  socialViewState.errorMessage = null;
  socialViewState.statusMessage = null;
  render();
  const finish = (error: Error | null, response?: SocialOperationResponse) => {
    socialViewState.isBusy = false;
    socialViewState.isLoading = false;
    if (error || !response) {
      socialViewState.errorMessage =
        "Social features are temporarily unavailable. Your room play is unaffected.";
    } else if (response.error) {
      socialViewState.errorMessage = response.error.message;
    } else {
      onSuccess(response);
    }
    render();
    if (focusScreenHeading) {
      const heading = appRoot.querySelector<HTMLElement>(".account-screen-title");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  };
  if (payload === undefined) {
    socket.timeout(5000).emit(eventName, finish);
  } else {
    socket.timeout(5000).emit(eventName, payload, finish);
  }
}

function loadSocialData(successMessage?: string): void {
  socialViewState.isLoading = true;
  runSocialOperation("get-social-data", undefined, (response) => {
    socialViewState.friends = response.friends ?? [];
    socialViewState.incomingRequests = response.incomingRequests ?? [];
    socialViewState.outgoingRequests = response.outgoingRequests ?? [];
    if (successMessage) socialViewState.statusMessage = successMessage;
  });
}

function loadNotifications(offset = 0, append = false): void {
  if (!authViewState.isAuthenticated || !socket.connected || socialViewState.notificationsLoading) return;
  socialViewState.notificationsLoading = true;
  socialViewState.notificationsError = null;
  render();
  socket.timeout(5000).emit(
    "get-notifications",
    { limit: 20, offset },
    (error: Error | null, response?: NotificationResponse) => {
      socialViewState.notificationsLoading = false;
      if (error || !response || response.error ||
        !Array.isArray(response.notifications) ||
        typeof response.unreadCount !== "number" ||
        !Number.isInteger(response.unreadCount) ||
        typeof response.hasMore !== "boolean") {
        socialViewState.notificationsError =
          response?.error?.message ?? "Notifications could not be loaded. Please try again.";
        render();
        return;
      }
      const next = append
        ? [...socialViewState.notifications, ...response.notifications]
        : response.notifications;
      socialViewState.notifications = Array.from(
        new Map(next.map((notification) => [notification.id, notification])).values(),
      );
      socialViewState.notificationsUnreadCount = response.unreadCount;
      socialViewState.notificationsOffset = socialViewState.notifications.length;
      socialViewState.notificationsHasMore = response.hasMore;
      socialViewState.notificationsError = null;
      render();
    },
  );
}

function updateNotificationRead(notificationId: string): void {
  if (!authViewState.isAuthenticated || socialViewState.notificationActionBusyId) return;
  socialViewState.notificationActionBusyId = notificationId;
  socialViewState.notificationsError = null;
  render();
  socket.timeout(5000).emit(
    "mark-notification-read",
    { notificationId },
    (error: Error | null, response?: NotificationResponse) => {
      socialViewState.notificationActionBusyId = null;
      if (error || !response || response.error || response.ok !== true) {
        socialViewState.notificationsError =
          response?.error?.message ?? "That notification could not be updated.";
        socialViewState.notificationPopoverOpen = true;
        render();
        return;
      }
      loadNotifications();
    },
  );
}

function markNotificationReadInBackground(notificationId: string): void {
  if (!authViewState.isAuthenticated) return;
  socket.timeout(5000).emit(
    "mark-notification-read",
    { notificationId },
    (error: Error | null, response?: NotificationResponse) => {
      if (error || !response || response.error || response.ok !== true) {
        socialViewState.notificationsError =
          response?.error?.message ?? "That notification could not be updated.";
        render();
        return;
      }
      const notification = socialViewState.notifications.find(({ id }) => id === notificationId);
      if (notification && !notification.readAt) {
        notification.readAt = new Date().toISOString();
        socialViewState.notificationsUnreadCount = Math.max(0, socialViewState.notificationsUnreadCount - 1);
      }
      render();
    },
  );
}

let notificationFocusRequestId: string | null = null;

const actions: AppActions = {
  onPlayerNameChange(name) {
    state.playerName = name;
    state.nameEntryError = null;
    state.errorMessage = null;
    state.errorCode = null;
    if (state.currentView === "game-selection" || (state.currentView === "public-rooms" && state.pendingPublicRoomId)) {
      render();
    }
  },
  onRoomCodeChange(code) {
    const normalizedCode = normalizeInvitationCode(code).slice(0, 4);
    if (state.pendingGameInvitationId && normalizedCode !== state.joinRoomCode) {
      state.pendingGameInvitationId = null;
    }
    state.joinRoomCode = normalizedCode;
    state.invitationMessage = null;
    if (state.errorCode === "INVALID_ROOM_CODE") {
      state.errorMessage = null;
      state.errorCode = null;
    }
  },
  onCreateRoom() {
    state.currentView = "game-selection";
    state.errorMessage = null;
    state.errorCode = null;
    state.nameEntryError = null;
    render();
  },
  onChooseGame(gameId) {
    if (state.isBusy) return;
    if (!state.availableGames.some((game) => game.id === gameId)) return;
    if (state.lobby) {
      const localPlayer = state.lobby.players.find(({ id }) => id === state.localPlayerId);
      if (localPlayer?.isHost !== true || state.lobby.status !== "lobby") return;
      actions.onSelectGame(gameId);
      return;
    }
    state.pendingGameId = gameId;
    state.errorMessage = null;
    state.errorCode = null;
    render();
  },
  onChooseRoomVisibility(visibility) {
    state.pendingRoomVisibility = visibility;
    render();
  },
  onConfirmCreateRoom(gameId) {
    if (
      state.isBusy ||
      gameId !== state.pendingGameId ||
      !state.availableGames.some((game) => game.id === gameId)
    ) return;
    const nameError = validatePlayerName(state.playerName);
    if (nameError) {
      state.nameEntryError = nameError;
      render();
      focusPlayerName("selection-player-name");
      return;
    }
    state.nameEntryError = null;
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "create-room",
      { playerName: state.playerName, gameId, visibility: state.pendingRoomVisibility },
      (response) => {
        if (response.error) {
          showOperationError(response);
          return;
        }
        state.isBusy = false;
        render();
      },
    );
  },
  onBackToHome() {
    if (state.isBusy) return;
    state.currentView = state.lobby ? "lobby" : "home";
    state.errorMessage = null;
    state.errorCode = null;
    state.nameEntryError = null;
    clearPlayerActionFeedback();
    render();
  },
  onOpenEmailAuth() {
    state.currentView = "email-auth";
    authViewState.errorMessage = null;
    authViewState.statusMessage = null;
    if (!authViewState.verificationRequired && authViewState.mode === "recovery") {
      authViewState.mode = pendingPasswordResetCode || recoveryLinkError
        ? "recovery"
        : "sign-in";
    }
    render();
    const title = appRoot.querySelector<HTMLElement>(".email-auth-title");
    if (title) {
      title.focus();
    }
  },
  onPlayAsGuest() {
    const user = firebaseClient?.currentUser;
    if (user) {
      const requiresEmailVerification = user.providerData.some(
        ({ providerId }) => providerId === "password",
      ) && !user.emailVerified;
      if (requiresEmailVerification) {
        authViewState.verificationRequired = true;
        authViewState.email = user.email ?? authViewState.email;
        authViewState.errorMessage =
          "Verify your email before entering the game. Resend the verification email below if needed.";
        state.currentView = "email-auth";
      } else {
        state.currentView = "home";
      }
      render();
      return;
    }
    state.currentView = "home";
    state.errorMessage = null;
    render();
  },
  onBackToWelcome() {
    if (authViewState.isBusy) return;
    state.currentView = authViewState.isAuthenticated ? "home" : "welcome";
    authViewState.errorMessage = null;
    render();
  },
  onNavigateAccount(view) {
    if (!authViewState.isAuthenticated) return;
    if (!["profile", "friends", "public-profile", "achievements"].includes(state.currentView)) {
      accountReturnView = state.currentView;
    }
    state.currentView = view;
    socialViewState.errorMessage = null;
    socialViewState.statusMessage = null;
    socialViewState.selectedProfile = null;
    socialViewState.isLoading = view === "profile" || view === "friends";
    if (view === "profile") {
      runSocialOperation("get-profile", undefined, (response) => {
        if (!response.profile) {
          socialViewState.errorMessage = "Your profile could not be loaded.";
          return;
        }
        socialViewState.profile = response.profile;
      }, true);
    } else if (view === "friends") {
      runSocialOperation("get-social-data", undefined, (response) => {
        socialViewState.friends = response.friends ?? [];
        socialViewState.incomingRequests = response.incomingRequests ?? [];
        socialViewState.outgoingRequests = response.outgoingRequests ?? [];
        if (notificationFocusRequestId) {
          queueMicrotask(() => {
            const requestId = notificationFocusRequestId;
            notificationFocusRequestId = null;
            const requestCard = Array.from(appRoot.querySelectorAll<HTMLElement>(".social-profile-card"))
              .find(({ dataset }) => dataset.requestId === requestId);
            if (requestCard) requestCard.tabIndex = -1;
            requestCard?.focus();
          });
        }
      }, true);
    } else {
      render();
      const heading = appRoot.querySelector<HTMLElement>(".account-screen-title");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  },
  onBackFromAccount() {
    state.currentView = accountReturnView;
    render();
  },
  onBackFromPublicProfile() {
    state.currentView = "friends";
    render();
    appRoot.querySelector<HTMLInputElement>("#player-search")?.focus();
  },
  onProfileDisplayNameChange(displayName) {
    const normalized = displayName.trim();
    if (normalized.length < 2 || normalized.length > 20) {
      socialViewState.errorMessage = "Display name must be 2–20 characters.";
      socialViewState.statusMessage = null;
      render();
      return;
    }
    runSocialOperation("update-profile-display-name", { displayName: normalized }, (response) => {
      if (response.profile) socialViewState.profile = response.profile;
      socialViewState.statusMessage = "Display name updated.";
    });
  },
  onInviteFriend(handle) {
    const friend = socialViewState.friends.find((entry) => entry.handle === handle);
    const roomCode = state.lobby?.roomCode;
    if (
      !authViewState.isAuthenticated ||
      !friend ||
      !roomCode ||
      !state.lobby ||
      state.lobby.playerCount >= state.lobby.maxPlayers
    ) return;
    if (state.isInvitationBusy) return;
    state.isInvitationBusy = true;
    state.errorMessage = null;
    state.errorCode = null;
    state.invitationFeedback = null;
    render();
    socket.timeout(5000).emit(
      "send-game-invitation",
      { handle: friend.handle },
      (error: Error | null, response?: NotificationResponse) => {
        state.isInvitationBusy = false;
        if (error || !response || response.error || typeof response.invitationId !== "string") {
          state.errorMessage = response?.error?.message ??
            "The in-app invitation could not be sent. You can still share the room link.";
          state.errorCode = response?.error?.code ?? "INVITATION_FAILED";
        } else {
          showInvitationFeedback(`Invitation sent to @${friend.handle}.`);
        }
        render();
      },
    );
  },
  onProfileHandleChange(handle) {
    const normalized = handle.trim().replace(/^@/u, "").toLowerCase();
    if (!/^[a-z0-9]{3,20}$/u.test(normalized)) {
      socialViewState.errorMessage = "Handles must contain 3–20 letters or numbers.";
      socialViewState.statusMessage = null;
      render();
      return;
    }
    runSocialOperation("update-profile-handle", { handle: normalized }, (response) => {
      if (response.profile) socialViewState.profile = response.profile;
      socialViewState.statusMessage = "Handle updated.";
    });
  },
  onCopyProfileHandle() {
    const handle = socialViewState.profile?.handle;
    if (!handle) return;
    void copyInvitationText(`@${handle}`).then(() => {
      socialViewState.statusMessage = "Handle copied.";
      render();
    }).catch(() => {
      socialViewState.errorMessage = "The handle could not be copied.";
      render();
    });
  },
  onSearchModeChange(mode) {
    socialViewState.searchMode = mode;
    socialViewState.searchQuery = "";
    socialViewState.searchResults = [];
    socialViewState.statusMessage = null;
    socialViewState.errorMessage = null;
    render();
  },
  onSearchProfiles(mode, query) {
    socialViewState.searchMode = mode;
    socialViewState.searchResults = [];
    const trimmed = query.trim();
    const normalized = mode === "handle"
      ? trimmed.replace(/^@/u, "").toLowerCase()
      : trimmed;
    socialViewState.searchQuery = mode === "handle" ? `@${normalized}` : normalized;
    const isValidQuery = mode === "handle"
      ? /^[a-z0-9]{3,20}$/u.test(normalized)
      : Array.from(normalized).length >= 2 && Array.from(normalized).length <= 20;
    if (!isValidQuery) {
      socialViewState.searchResults = [];
      socialViewState.statusMessage = null;
      socialViewState.errorMessage = mode === "handle"
        ? "Enter a handle with 3–20 letters or numbers."
        : "Enter a display name with 2–20 characters.";
      render();
      return;
    }
    runSocialOperation("search-profiles", { mode, query: normalized }, (response) => {
      socialViewState.searchResults = response.profiles ?? [];
      socialViewState.statusMessage = null;
    });
  },
  onOpenPublicProfile(handle) {
    socialViewState.selectedProfile = null;
    socialViewState.errorMessage = null;
    socialViewState.statusMessage = null;
    socialViewState.isLoading = true;
    state.currentView = "public-profile";
    runSocialOperation("get-public-profile", { handle }, (response) => {
      socialViewState.selectedProfile = response.profile ?? null;
      if (!response.profile) socialViewState.statusMessage = "Player not found.";
    }, true);
  },
  onFindPlayerFromResults(displayName) {
    state.currentView = "friends";
    socialViewState.friendsTab = "find";
    socialViewState.searchMode = "displayName";
    socialViewState.searchQuery = displayName;
    socialViewState.searchResults = [];
    render();
    actions.onSearchProfiles("displayName", displayName);
  },
  onSendFriendRequest(handle) {
    if (handle === socialViewState.profile?.handle) {
      socialViewState.errorMessage = "You cannot send a friend request to yourself.";
      render();
      return;
    }
    runSocialOperation("send-friend-request", { handle }, (response) => {
      if (typeof response.requestId === "string") {
        socialViewState.outgoingRequests.push({
          requestId: response.requestId,
          handle,
          displayName: socialViewState.searchResults.find((profile) => profile.handle === handle)?.displayName
            ?? socialViewState.selectedProfile?.displayName
            ?? handle,
        });
      }
      loadSocialData("Friend request sent.");
      loadNotifications();
    });
  },
  onRespondToFriendRequest(requestId, action) {
    runSocialOperation("respond-friend-request", { requestId, action }, () => {
      loadSocialData(action === "accept" ? "Friend request accepted." : "Friend request declined.");
      loadNotifications();
    });
  },
  onCancelFriendRequest(requestId) {
    runSocialOperation("cancel-friend-request", { requestId }, () => {
      loadSocialData("Friend request cancelled.");
    });
  },
  onRemoveFriend(handle) {
    runSocialOperation("remove-friend", { handle }, () => {
      loadSocialData("Friend removed.");
    });
  },
  onChooseAnotherGame() {
    const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
    if (!state.lobby || localPlayer?.isHost !== true || state.lobby.status !== "lobby" || state.isBusy) return;
    state.currentView = "game-selection";
    state.errorMessage = null;
    state.errorCode = null;
    render();
  },
  onToggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    persistThemePreference(state.theme);
    applyThemePreference();
    render();
  },
  onSetThemePreference(theme: ThemePreference) {
    state.theme = theme;
    persistThemePreference(theme);
    applyThemePreference();
    render();
  },
  onToggleNotifications() {
    socialViewState.notificationPopoverOpen = !socialViewState.notificationPopoverOpen;
    render();
    if (socialViewState.notificationPopoverOpen) {
      loadNotifications();
      if (notificationRefreshTimer) clearInterval(notificationRefreshTimer);
      notificationRefreshTimer = setInterval(() => loadNotifications(), 30_000);
    } else {
      if (notificationRefreshTimer) clearInterval(notificationRefreshTimer);
      notificationRefreshTimer = null;
      appRoot.querySelector<HTMLElement>(".notification-trigger")?.focus();
    }
  },
  onReloadNotifications() {
    if (!socialViewState.notificationsLoading) loadNotifications();
  },
  onLoadMoreNotifications() {
    if (!socialViewState.notificationsLoading && socialViewState.notificationsHasMore) {
      loadNotifications(socialViewState.notificationsOffset, true);
    }
  },
  onMarkNotificationRead(notificationId) {
    updateNotificationRead(notificationId);
  },
  onNotificationAction(notification) {
    socialViewState.notificationPopoverOpen = false;
    if (notificationRefreshTimer) clearInterval(notificationRefreshTimer);
    notificationRefreshTimer = null;
    markNotificationReadInBackground(notification.id);
    if (notification.type === "friend_request") {
      socialViewState.friendsTab = "requests";
      socialViewState.requestsTab = "incoming";
      notificationFocusRequestId = notification.requestId;
      actions.onNavigateAccount("friends");
      socialViewState.friendsTab = "requests";
      socialViewState.requestsTab = "incoming";
      return;
    }
    if (notification.type === "accepted_friend_request") {
      actions.onOpenPublicProfile(notification.actor.handle);
      return;
    }
    const invitation = notification.invitation;
    if (!invitation || invitation.status !== "pending" || Date.parse(invitation.expiresAt) <= Date.now()) {
      socialViewState.notificationPopoverOpen = true;
      socialViewState.notificationsError = "This game invitation has expired or is no longer available.";
      render();
      return;
    }
    state.currentView = "home";
    state.joinRoomCode = invitation.roomCode;
    state.pendingGameInvitationId = invitation.id;
    state.invitationMessage = "Game invitation ready. Enter your name, then join the room.";
    render();
    focusPlayerName("player-name");
  },
  onDeclineGameInvitation(invitationId) {
    if (socialViewState.notificationActionBusyId) return;
    socialViewState.notificationActionBusyId = invitationId;
    render();
    socket.timeout(5000).emit(
      "decline-game-invitation",
      { invitationId },
      (error: Error | null, response?: NotificationResponse) => {
        socialViewState.notificationActionBusyId = null;
        if (error || !response || response.error || response.ok !== true) {
          socialViewState.notificationsError =
            response?.error?.message ?? "The game invitation could not be declined.";
          render();
          return;
        }
        loadNotifications();
      },
    );
  },
  onFriendsTabChange(tab) {
    socialViewState.friendsTab = tab;
    render();
    if (tab === "find") appRoot.querySelector<HTMLInputElement>("#player-search")?.focus();
  },
  onRequestsTabChange(tab) {
    socialViewState.requestsTab = tab;
    render();
  },
  onBrowsePublicRooms() {
    if (state.connectionStatus !== "connected" || state.isBusy) return;
    clearPublicRoomSelection();
    state.currentView = "public-rooms";
    state.publicRoomsError = null;
    state.isLoadingPublicRooms = true;
    subscribeToPublicRooms();
  },
  onRefreshPublicRooms() {
    if (state.connectionStatus === "connected" && !state.isLoadingPublicRooms) refreshPublicRooms();
  },
  onJoinPublicRoom(roomId) {
    if (state.connectionStatus !== "connected" || state.isBusy) return;
    if (!isPublicRoomJoinable(state.publicRooms, roomId)) {
      clearPublicRoomSelection();
      state.publicRoomsError =
        "That room is no longer available. Refresh the list or choose another room.";
      render();
      return;
    }
    const nameError = validatePlayerName(state.playerName);
    if (nameError) {
      state.pendingPublicRoomId = roomId;
      state.nameEntryError = nameError;
      render();
      focusPlayerName("public-room-player-name");
      return;
    }
    clearPublicRoomSelection();
    state.isBusy = true;
    state.publicRoomsError = null;
    render();
    socket.timeout(5000).emit(
      "join-public-room",
      { publicRoomId: roomId, playerName: state.playerName },
      (transportError: Error | null, response?: RoomOperationResponse) => {
      state.isBusy = false;
      if (transportError || !response) {
        state.publicRoomsError = "The server did not respond. Refresh the list and try again.";
        render();
        focusPublicRoomJoin(roomId);
        return;
      }
      if (response.error) {
        if (
          response.error.code === "PUBLIC_ROOM_NOT_FOUND" ||
          response.error.code === "ROOM_NOT_PUBLIC" ||
          response.error.code === "ROOM_FULL"
        ) {
          markPublicRoomUnavailable(roomId, response.error.message);
        } else {
          state.publicRoomsError = response.error.message;
        }
        render();
        focusPublicRoomJoin(roomId);
        return;
      }
      if (!response.lobby) {
        state.publicRoomsError = "The room joined, but its current state could not be loaded. Refresh and try again.";
        render();
        focusPublicRoomJoin(roomId);
        return;
      }
      unsubscribeFromPublicRooms();
      state.pendingPublicRoomId = null;
      applyLobbyState(response.lobby);
      },
    );
  },
  onContinuePublicRoomJoin() {
    if (!state.isBusy && state.pendingPublicRoomId) actions.onJoinPublicRoom(state.pendingPublicRoomId);
  },
  onCancelPublicRoomJoin() {
    if (state.isBusy || !state.pendingPublicRoomId) return;
    const roomId = state.pendingPublicRoomId;
    clearPublicRoomSelection();
    render();
    focusPublicRoomJoin(roomId);
  },
  onBackFromPublicRooms() {
    if (state.isBusy) return;
    unsubscribeFromPublicRooms();
    state.currentView = "home";
    state.publicRoomsError = null;
    clearPublicRoomSelection();
    state.errorMessage = null;
    render();
  },
  onJoinRoom(roomCode) {
    if (state.isBusy || state.connectionStatus !== "connected") return;
    const normalizedCode = normalizeInvitationCode(roomCode);
    if (!/^[A-Z]{4}$/u.test(normalizedCode)) {
      state.errorMessage = "Enter a four-letter room code.";
      state.errorCode = "INVALID_ROOM_CODE";
      render();
      return;
    }
    const nameError = validatePlayerName(state.playerName);
    if (nameError) {
      state.errorMessage = nameError;
      state.errorCode = "INVALID_NAME";
      render();
      focusPlayerName("player-name");
      return;
    }
    state.joinRoomCode = normalizedCode;
    state.invitationMessage = null;
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      state.pendingGameInvitationId ? "accept-game-invitation" : "join-room",
      state.pendingGameInvitationId
        ? { invitationId: state.pendingGameInvitationId, playerName: state.playerName }
        : { roomCode: normalizedCode, playerName: state.playerName },
      (response) => {
        if (response.error) {
          state.pendingGameInvitationId = null;
          showOperationError(response);
          return;
        }
        if (state.pendingGameInvitationId && response.lobby) {
          state.pendingGameInvitationId = null;
          applyLobbyState(response.lobby);
          return;
        }
        if (state.pendingGameInvitationId) {
          state.pendingGameInvitationId = null;
          showOperationError({
            error: { code: "INVALID_RESPONSE", message: "The invitation join could not be confirmed." },
          });
          return;
        }
        state.isBusy = false;
        render();
      },
    );
  },
  onLeaveRoom() {
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation("leave-room", undefined, (response) => {
      if (response.error) {
        showOperationError(response);
        return;
      }
      if (!response.left) {
        showOperationError(response);
        return;
      }
      state.currentView = "home";
      state.roomCode = null;
      state.localPlayerId = null;
      state.lobby = null;
      state.game = null;
      state.isSendingResultsReminder = false;
      clearResultsReminderSuccess();
      clearInvitationFeedback();
      clearPlayerActionFeedback();
      resetFakeAnswerViewState();
      state.isBusy = false;
      state.errorMessage = null;
      state.errorCode = null;
      render();
    });
  },
  onSetRoomVisibility(visibility) {
    state.isBusy = true;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    emitRoomOperation("set-room-visibility", { visibility }, (response) => {
      if (response.error) {
        showOperationError(response);
        return;
      }
      state.isBusy = false;
      if (response.lobby) applyLobbyState(response.lobby);
      else render();
    });
  },
  onOpenPlayerCard(playerId) {
    if (state.isBusy || !state.lobby || !state.lobby.players.some(({ id }) => id === playerId)) return;
    state.selectedPlayerId = state.selectedPlayerId === playerId ? null : playerId;
    render();
    if (state.selectedPlayerId) {
      appRoot.querySelector<HTMLButtonElement>(".player-detail-close")?.focus();
    } else {
      focusPlayerCardTrigger(playerId);
    }
  },
  onClosePlayerCard() {
    const playerId = state.selectedPlayerId;
    if (!playerId) return;
    state.selectedPlayerId = null;
    render();
    focusPlayerCardTrigger(playerId);
  },
  onRequestKickPlayer(playerId) {
    const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
    if (state.isBusy || !state.lobby || state.lobby.status !== "lobby" || !localPlayer?.isHost || playerId === state.localPlayerId) return;
    const target = state.lobby.players.find(({ id }) => id === playerId);
    if (!target || target.isHost) return;
    state.pendingKickPlayerId = playerId;
    state.pendingHostTransferId = null;
    state.selectedPlayerId = null;
    state.kickFeedback = null;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    appRoot.querySelector<HTMLButtonElement>("#kick-confirmation-cancel")?.focus();
  },
  onRequestHostTransfer(playerId) {
    const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
    const target = state.lobby?.players.find(({ id }) => id === playerId);
    if (!state.lobby || state.lobby.status !== "lobby" || !localPlayer?.isHost || !target || target.isHost || playerId === state.localPlayerId || state.isBusy) return;
    state.pendingHostTransferId = playerId;
    state.pendingKickPlayerId = null;
    state.selectedPlayerId = null;
    state.kickFeedback = null;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    appRoot.querySelector<HTMLButtonElement>("#kick-confirmation-cancel")?.focus();
  },
  onConfirmKickPlayer() {
    const playerId = state.pendingKickPlayerId;
    const lobby = state.lobby;
    const localPlayer = lobby?.players.find(({ id }) => id === state.localPlayerId);
    if (!playerId || !lobby || lobby.status !== "lobby" || !localPlayer?.isHost || state.isBusy) return;
    const player = lobby.players.find(({ id }) => id === playerId);
    if (!player || player.isHost) {
      state.pendingKickPlayerId = null;
      render();
      focusPlayerCardTrigger(playerId);
      return;
    }
    state.isBusy = true;
    state.errorMessage = null;
    state.kickFeedback = null;
    render();
    emitRoomOperation("kick-player", { targetPlayerId: playerId }, (response) => {
      state.isBusy = false;
      state.pendingKickPlayerId = null;
      if (response.error) {
        showOperationError(response);
        focusPlayerCardTrigger(playerId);
        return;
      }
      showPlayerActionFeedback(`${player.name} was removed from the room.`);
      render();
    });
  },
  onConfirmHostTransfer() {
    const playerId = state.pendingHostTransferId;
    const lobby = state.lobby;
    const localPlayer = lobby?.players.find(({ id }) => id === state.localPlayerId);
    const player = lobby?.players.find(({ id }) => id === playerId);
    if (!playerId || !lobby || lobby.status !== "lobby" || !localPlayer?.isHost || state.isBusy) return;
    if (!player || player.isHost) {
      state.pendingHostTransferId = null;
      render();
      focusPlayerCardTrigger(playerId);
      return;
    }
    state.isBusy = true;
    state.errorMessage = null;
    state.kickFeedback = null;
    render();
    emitRoomOperation("transfer-host", { targetPlayerId: playerId }, (response) => {
      state.isBusy = false;
      state.pendingHostTransferId = null;
      if (response.error) {
        showOperationError(response);
        focusPlayerCardTrigger(playerId);
        return;
      }
      state.selectedPlayerId = null;
      if (response.lobby) applyLobbyState(response.lobby);
      showPlayerActionFeedback(`${player.name} is now the host.`);
      render();
      focusPlayerCardTrigger(playerId);
    });
  },
  onCancelKickPlayer() {
    if (state.isBusy) return;
    const cancelledPlayerId = state.pendingKickPlayerId ?? state.pendingHostTransferId;
    state.pendingKickPlayerId = null;
    state.pendingHostTransferId = null;
    render();
    if (cancelledPlayerId) focusPlayerCardTrigger(cancelledPlayerId);
  },
  onCopyRoomCode() {
    const roomCode = state.lobby?.roomCode;
    if (!roomCode) return;
    runInvitationAction(async () => {
      await copyInvitationText(roomCode);
      return "Room code copied.";
    }, true);
  },
  onOpenInvitationDialog() {
    if (!state.lobby || state.lobby.status !== "lobby" || state.isBusy) return;
    if (state.lobby.playerCount >= state.lobby.maxPlayers) {
      state.errorMessage = "This room is full and cannot accept new players.";
      state.errorCode = "ROOM_FULL";
      render();
      return;
    }
    try {
      const url = buildCurrentInvitationUrl(state.lobby.roomCode);
      if (state.invitationUrl !== url) {
        state.invitationQrDataUrl = null;
        state.isInvitationQrVisible = false;
      }
      state.invitationUrl = url;
      state.isInvitationDialogOpen = true;
      state.errorMessage = null;
      state.errorCode = null;
    } catch {
      state.errorMessage = "The invitation link could not be created. Check the public app URL configuration.";
      state.errorCode = "INVITATION_URL_INVALID";
    }
    render();
    if (authViewState.isAuthenticated) loadSocialData();
  },
  onCloseInvitationDialog() {
    if (!state.isInvitationDialogOpen) return;
    state.isInvitationDialogOpen = false;
    render();
    appRoot.querySelector<HTMLButtonElement>(".invite-friends-button")?.focus();
  },
  onCopyInvitationLink() {
    const url = state.invitationUrl;
    if (!url || !state.lobby || state.lobby.playerCount >= state.lobby.maxPlayers) return;
    runInvitationAction(async () => {
      await copyInvitationText(url);
      return "Invitation link copied.";
    });
  },
  onShareInvitationLink() {
    const roomCode = state.lobby?.roomCode;
    const url = state.invitationUrl;
    if (!roomCode || !url || !state.lobby || state.lobby.playerCount >= state.lobby.maxPlayers) return;
    runInvitationAction(async () => {
      const result = await shareOrCopyInvitation(
        { title: "Join my SUSSED! room", text: `Join my SUSSED! room with code ${roomCode}.`, url },
        {
          share: typeof navigator.share === "function"
            ? (data) => navigator.share(data)
            : undefined,
          copy: copyInvitationText,
        },
      );
      return result === "shared"
        ? "Share sheet opened. Delivery is not confirmed."
        : "Sharing was unavailable; invitation link copied.";
    });
  },
  onToggleInvitationQr() {
    if (state.isBusy || state.isInvitationBusy || !state.invitationUrl) return;
    if (state.isInvitationQrVisible) {
      state.isInvitationQrVisible = false;
      render();
      return;
    }
    if (state.invitationQrDataUrl) {
      state.isInvitationQrVisible = true;
      render();
      return;
    }
    state.isInvitationBusy = true;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    void createInvitationQrDataUrl(state.invitationUrl).then((dataUrl) => {
      state.invitationQrDataUrl = dataUrl;
      state.isInvitationQrVisible = true;
    }).catch(() => {
      state.errorMessage = "The QR code could not be created. Copy the invitation link instead.";
      state.errorCode = "INVITATION_QR_FAILED";
    }).finally(() => {
      state.isInvitationBusy = false;
      render();
    });
  },
  onSetReady(isReady) {
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "set-ready",
      { isReady },
      (response) => {
        if (response.error) {
          showOperationError(response);
          return;
        }
        state.isBusy = false;
        render();
      },
    );
  },
  onSelectGame(gameId) {
    const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
    if (
      !state.lobby ||
      localPlayer?.isHost !== true ||
      state.lobby.status !== "lobby" ||
      gameId === state.lobby.selectedGameId ||
      !state.availableGames.some((game) => game.id === gameId)
    ) {
      return;
    }
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation("select-game", { gameId }, (response) => {
      if (response.error) {
        state.isBusy = false;
        showOperationError(response);
        return;
      }
      if (response.lobby) {
        state.isBusy = false;
        applyLobbyState(response.lobby);
      } else {
        state.isBusy = false;
        render();
      }
    });
  },
  onSelectRoundCount(roundCount, revision) {
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "select-round-count",
      { roundCount, revision },
      (response) => {
        if (response.error) {
          showOperationError(response);
          return;
        }
        if (response.lobby) {
          applyLobbyState(response.lobby);
        } else {
          state.isBusy = false;
          render();
        }
      },
    );
  },
  onStartGame() {
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation("start-game", undefined, (response) => {
      if (response.error) {
        showOperationError(response);
        return;
      }
      state.isBusy = false;
      if (response.game) {
        applyGameState(response.game);
        return;
      }
      render();
    });
  },
  onSubmitFakeAnswer(completion) {
    const identity = currentFakeAnswerIdentity();
    if (!identity || fakeAnswerHasSubmitted || fakeAnswerIsSubmitting) {
      return;
    }

    fakeAnswerErrorMessage = null;
    fakeAnswerCompletionDraft = completion;
    fakeAnswerIsSubmitting = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:submit",
      { completion, ...identity },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentFakeAnswerIdentity(identity)) {
          return;
        }
        fakeAnswerIsSubmitting = false;
        if (error || !response) {
          fakeAnswerErrorMessage = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerErrorMessage = response.error.message;
          if (
            response.error.code === "GAME_NOT_ACTIVE" ||
            response.error.code === "SESSION_MISMATCH"
          ) {
            recoverFromUnavailableGame();
            return;
          }
        } else if (response.submitted) {
          fakeAnswerHasSubmitted = true;
          fakeAnswerCompletionDraft = "";
          fakeAnswerErrorMessage = null;
        } else {
          fakeAnswerErrorMessage = "Your answer could not be submitted.";
        }
        render();
      },
    );
  },
  onSubmitBruhAnswer(answer) {
    const identity = currentBruhIdentity();
    if (!identity || bruhIsSubmitting || !isBruhWtfPublicState(state.game?.state) || state.game.state.phase !== "answer-submission") return;
    bruhAnswerDraft = answer;
    bruhSubmitError = null;
    bruhIsSubmitting = true;
    render();
    socket.timeout(5000).emit(
      "bruh-wtf:submit",
      { answer, ...identity },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentBruhIdentity(identity)) return;
        bruhIsSubmitting = false;
        if (error || !response) {
          bruhSubmitError = "The server did not respond. Please try again.";
        } else if (response.error) {
          bruhSubmitError = response.error.message;
          if (response.error.code === "GAME_NOT_ACTIVE" || response.error.code === "SESSION_MISMATCH") {
            recoverFromUnavailableGame();
            return;
          }
        } else if (response.submitted) {
          bruhAnswerDraft = "";
          bruhSubmitError = null;
        } else {
          bruhSubmitError = "Your answer could not be submitted.";
        }
        render();
      },
    );
  },
  onBruhAnswerDraftChange(answer) {
    bruhAnswerDraft = answer;
  },
  onSelectBruhVote(optionId) {
    bruhSelectedOptionId = optionId;
    bruhVoteError = null;
  },
  onVoteBruhWtf(optionId) {
    const identity = currentBruhIdentity();
    if (!identity || bruhIsVoting) return;
    bruhVoteError = null;
    bruhIsVoting = true;
    render();
    socket.timeout(5000).emit(
      "bruh-wtf:vote",
      { optionId, ...identity },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentBruhIdentity(identity)) return;
        bruhIsVoting = false;
        if (error || !response) bruhVoteError = "The server did not respond. Please try again.";
        else if (response.error) bruhVoteError = response.error.message;
        else if (!response.voted) bruhVoteError = "Your vote could not be submitted.";
        else bruhVoteError = null;
        render();
      },
    );
  },
  onContinueBruhWtf() {
    const identity = currentBruhIdentity();
    if (!identity || bruhIsContinuing) return;
    bruhContinueError = null;
    bruhIsContinuing = true;
    render();
    socket.timeout(5000).emit(
      "bruh-wtf:continue",
      identity,
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentBruhIdentity(identity)) return;
        bruhIsContinuing = false;
        if (error || !response) bruhContinueError = "The server did not respond. Please try again.";
        else if (response.error) bruhContinueError = response.error.message;
        else if (!response.ready) bruhContinueError = "You could not continue to the next round.";
        else bruhContinueError = null;
        render();
      },
    );
  },
  onSelectVote(optionId) {
    fakeAnswerSelectedOptionId = optionId;
    fakeAnswerVoteError = null;
    render();
  },
  onVoteFakeAnswer(optionId) {
    const identity = currentFakeAnswerIdentity();
    if (!identity || fakeAnswerHasVoted || fakeAnswerIsVoting) {
      return;
    }

    fakeAnswerVoteError = null;
    fakeAnswerIsVoting = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:vote",
      { optionId, ...identity },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentFakeAnswerIdentity(identity)) {
          return;
        }
        fakeAnswerIsVoting = false;
        if (error || !response) {
          fakeAnswerVoteError = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerVoteError = response.error.message;
          if (
            response.error.code === "GAME_NOT_ACTIVE" ||
            response.error.code === "SESSION_MISMATCH"
          ) {
            recoverFromUnavailableGame();
            return;
          }
        } else if (response.voted) {
          fakeAnswerHasVoted = true;
          fakeAnswerVoteError = null;
        } else {
          fakeAnswerVoteError = "Your vote could not be submitted.";
        }
        render();
      },
    );
  },
  onContinueFakeAnswer() {
    const identity = currentFakeAnswerIdentity();
    if (!identity || fakeAnswerIsContinuing) {
      return;
    }

    fakeAnswerContinueError = null;
    fakeAnswerIsContinuing = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:continue",
      identity,
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        if (!isCurrentFakeAnswerIdentity(identity)) {
          return;
        }
        fakeAnswerIsContinuing = false;
        if (error || !response) {
          fakeAnswerContinueError = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerContinueError = response.error.message;
          if (
            response.error.code === "GAME_NOT_ACTIVE" ||
            response.error.code === "SESSION_MISMATCH"
          ) {
            recoverFromUnavailableGame();
            return;
          }
        } else if (!response.ready) {
          fakeAnswerContinueError = "You could not continue to the next round.";
        } else {
          fakeAnswerContinueError = null;
        }
        render();
      },
    );
  },
  onReturnToLobby() {
    if (fakeAnswerIsReturningToLobby || !state.game) {
      return;
    }

    const sessionId = state.game.sessionId;
    fakeAnswerReturnToLobbyError = null;
    fakeAnswerIsReturningToLobby = true;
    render();
    socket.timeout(5000).emit(
      "return-to-lobby",
      { sessionId },
      (error: Error | null, response?: RoomOperationResponse) => {
        if (state.game?.sessionId !== sessionId) {
          return;
        }
        fakeAnswerIsReturningToLobby = false;
        if (error || !response) {
          fakeAnswerReturnToLobbyError =
            "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerReturnToLobbyError = response.error.message;
          if (response.error.code === "SESSION_MISMATCH") {
            recoverFromUnavailableGame();
            return;
          }
        } else if (!response.returned) {
          fakeAnswerReturnToLobbyError =
            "The room could not be returned to the lobby.";
        } else {
          fakeAnswerReturnToLobbyError = null;
        }
        render();
      },
    );
  },
  onReturnFromResults() {
    const sessionId = state.game?.sessionId;
    if (!sessionId || fakeAnswerIsReturningToLobby) return;
    fakeAnswerReturnToLobbyError = null;
    fakeAnswerIsReturningToLobby = true;
    render();
    socket.timeout(5000).emit(
      "return-from-results",
      { sessionId },
      (error: Error | null, response?: RoomOperationResponse) => {
        if (state.game?.sessionId !== sessionId) return;
        if (error || !response) {
          fakeAnswerIsReturningToLobby = false;
          fakeAnswerReturnToLobbyError = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerIsReturningToLobby = false;
          fakeAnswerReturnToLobbyError = response.error.message;
        } else if (!response.returned) {
          fakeAnswerIsReturningToLobby = false;
          fakeAnswerReturnToLobbyError = "The room could not be returned to its current state.";
        } else {
          // Keep duplicate clicks disabled until the authoritative lobby state arrives.
          fakeAnswerReturnToLobbyError = null;
        }
        render();
      },
    );
  },
  onToggleResultsHistory() {
    allRoundHistoryOpen = !allRoundHistoryOpen;
    if (allRoundHistoryOpen) allRoundHistoryPage = -1;
    render();
  },
  onResultsHistoryPage(page: number) {
    allRoundHistoryPage = page;
    render();
  },
  onAskResultsViewersToReturn() {
    const roomCode = state.lobby?.roomCode;
    const sessionId = state.lobby?.reminderSessionId;
    if (!roomCode || !sessionId || state.isSendingResultsReminder || state.isBusy) return;
    state.errorCode = null;
    state.errorMessage = null;
    clearResultsReminderSuccess();
    state.isSendingResultsReminder = true;
    render();
    socket.timeout(5000).emit(
      "ask-results-viewers-to-return",
      { sessionId },
      (error: Error | null, response?: RoomOperationResponse) => {
        if (
          state.currentView !== "lobby" ||
          state.lobby?.roomCode !== roomCode ||
          state.lobby.reminderSessionId !== sessionId
        ) return;
        state.isSendingResultsReminder = false;
        if (error || !response) {
          state.errorCode = "SERVER_TIMEOUT";
          state.errorMessage = "The server did not respond. Please try again.";
        } else if (response.error) {
          state.errorCode = response.error.code;
          state.errorMessage = response.error.message;
        } else if (typeof response.sent === "number") {
          showResultsReminderSuccess(roomCode, sessionId);
        } else {
          state.errorCode = "INVALID_RESPONSE";
          state.errorMessage = "The reminder result was unclear. Please try again.";
        }
        render();
      },
    );
  },
  onDismissResultsReminder() {
    if (state.isBusy) return;
    state.resultsReminderSessionId = null;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    focusCurrentScreen();
  },
  onAcceptResultsReminder() {
    const sessionId = state.resultsReminderSessionId;
    if (!sessionId || state.isBusy) return;
    state.isBusy = true;
    state.errorMessage = null;
    state.errorCode = null;
    render();
    emitRoomOperation("return-from-results", { sessionId }, (response) => {
      if (response.error) {
        state.isBusy = false;
        state.errorCode = response.error.code;
        state.errorMessage = response.error.message;
        render();
      } else if (response.returned !== true) {
        state.isBusy = false;
        state.errorCode = "INVALID_RESPONSE";
        state.errorMessage = "The room could not be returned to its current state. Please try again.";
        render();
      }
    });
  },
  onDismissRoundFeedback() {
    if (
      isFakeAnswerPublicState(state.game?.state) &&
      state.game.state.phase === "results" &&
      state.game
    ) {
      fakeAnswerFeedbackDismissedIdentity =
        `${state.game.sessionId}:${state.game.state.roundId}`;
      render();
    }
  },
  onAuthModeChange(mode) {
    if (authViewState.isBusy) return;
    authViewState.mode = mode;
    authViewState.errorMessage = null;
    authViewState.statusMessage = null;
    authViewState.password = "";
    authViewState.passwordConfirmation = "";
    render();
  },
  onAuthFieldChange(field, value) {
    authViewState[field] = value;
    authViewState.errorMessage = null;
  },
  onAuthSubmit() {
    if (!authService) return;
    void runAuthAction(async () => {
      if (authViewState.mode === "sign-up") {
        const result = await authService.signUp(
          authViewState.email,
          authViewState.password,
        );
        authViewState.password = "";
        authViewState.verificationRequired =
          result.requiresEmailVerification === true;
        authViewState.userEmail = result.requiresEmailVerification
          ? null
          : result.user?.email ?? authViewState.userEmail;
        authViewState.statusMessage = result.requiresEmailVerification
          ? "Check your inbox for a verification link before signing in."
          : "Your account is ready.";
        return;
      }
      if (authViewState.mode === "sign-in") {
        const result = await authService.signIn(
          authViewState.email,
          authViewState.password,
        );
        authViewState.password = "";
        authViewState.verificationRequired =
          result.requiresEmailVerification === true;
        authViewState.userEmail = authViewState.verificationRequired
          ? null
          : result.user?.email ?? null;
        authViewState.statusMessage = authViewState.verificationRequired
          ? "Verify your email before using this account. You can resend the verification email below."
          : "You’re signed in.";
        return;
      }
      if (authViewState.mode === "forgot-password") {
        await authService.requestPasswordRecovery(authViewState.email);
        authViewState.statusMessage =
          "If an account exists for that address, a password recovery email is on its way.";
        return;
      }
      if (authViewState.password !== authViewState.passwordConfirmation) {
        throw new Error("The new passwords do not match.");
      }
      if (!authViewState.hasRecoverySession) {
        throw new Error("This recovery link is invalid or expired. Request a new recovery email.");
      }
      if (!pendingPasswordResetCode) {
        throw new Error("This recovery link is invalid or expired. Request a new recovery email.");
      }
      await authService.confirmPasswordReset(
        pendingPasswordResetCode,
        authViewState.password,
      );
      pendingPasswordResetCode = null;
      authViewState.password = "";
      authViewState.passwordConfirmation = "";
      authViewState.hasRecoverySession = false;
      authViewState.mode = "sign-in";
      authViewState.recoveryError = null;
      authViewState.statusMessage = "Your password was updated. Sign in with your new password.";
    });
  },
  onAuthGoogle() {
    if (!authService) {
      authViewState.errorMessage =
        authViewState.configurationError ?? "Firebase authentication is not configured.";
      render();
      return;
    }
    void runAuthAction(() => authService.signInWithGoogle());
  },
  onAuthResendVerification() {
    if (!authService || authViewState.isBusy) return;
    void runAuthAction(async () => {
      const result = await authService.resendVerification(authViewState.email);
      if (result === "already-verified") {
        authViewState.verificationRequired = false;
        const user = firebaseClient?.currentUser ?? null;
        authViewState.userEmail = user?.email ?? null;
        authViewState.isAuthenticated = Boolean(user?.emailVerified && user.providerData.length > 0);
        authViewState.statusMessage = "This email is already verified. You can sign in now.";
        if (authViewState.isAuthenticated) state.currentView = "home";
        return;
      }
      authViewState.statusMessage = "A new verification email has been sent.";
      authViewState.resendAvailableAt = Date.now() + 60_000;
      if (resendCooldownTimer) clearInterval(resendCooldownTimer);
      resendCooldownTimer = setInterval(() => {
        if (
          authViewState.resendAvailableAt === null ||
          authViewState.resendAvailableAt <= Date.now()
        ) {
          if (resendCooldownTimer) clearInterval(resendCooldownTimer);
          resendCooldownTimer = null;
        }
        render();
      }, 1000);
    });
  },
  onAuthSignOut() {
    if (!authService) return;
    void runAuthAction(async () => {
      await authService.signOut();
      authViewState.userEmail = null;
      authViewState.isAuthenticated = false;
      authViewState.statusMessage = null;
      state.currentView = "welcome";
    });
  },
};

const handleSocketSessionChange = createSocketSessionChangeHandler(socket);
const retrySocketWithFreshIdToken = createSocketTokenRefreshRetry(
  socket,
  () => firebaseClient?.currentUser ?? null,
);
if (firebaseClient) {
  let isInitialFirebaseAuthState = true;
  let initialAuthResolved = false;
  let observedUserId: string | null | undefined;
  let observedAuthenticated: boolean | null = null;
  onIdTokenChanged(firebaseClient, (user) => {
    const requiresEmailVerification = Boolean(
      user &&
      user.providerData.some(({ providerId }) => providerId === "password") &&
      !user.emailVerified,
    );
    const eligibleForAuthenticatedSocket = Boolean(
      user?.emailVerified && user.providerData.length > 0,
    );
    const userId = user?.uid ?? null;
    const identityChanged = observedUserId !== userId;
    const authenticationChanged = observedAuthenticated !== eligibleForAuthenticatedSocket;
    const isInitialState = isInitialFirebaseAuthState;
    observedUserId = userId;
    observedAuthenticated = eligibleForAuthenticatedSocket;
    handleSocketSessionChange(
      isInitialState
        ? "INITIAL_SESSION"
        : user
          ? "SIGNED_IN"
          : "SIGNED_OUT",
      eligibleForAuthenticatedSocket && user
        ? { user: { id: user.uid } }
        : null,
    );
    isInitialFirebaseAuthState = false;
    authViewState.verificationRequired = requiresEmailVerification;
    authViewState.userEmail = requiresEmailVerification ? null : user?.email ?? null;
    authViewState.isAuthenticated = eligibleForAuthenticatedSocket;
    if (!eligibleForAuthenticatedSocket) {
      socialViewState.notifications = [];
      socialViewState.notificationsUnreadCount = 0;
      socialViewState.notificationPopoverOpen = false;
      socialViewState.notificationsOffset = 0;
      socialViewState.notificationsHasMore = false;
      if (notificationRefreshTimer) clearInterval(notificationRefreshTimer);
      notificationRefreshTimer = null;
    }
    if (user && requiresEmailVerification && user.email) {
      authViewState.email = user.email;
    }
    if (!user && !pendingPasswordResetCode) {
      authViewState.hasRecoverySession = false;
      authViewState.password = "";
      authViewState.passwordConfirmation = "";
    }
    if (
      initialAuthResolved &&
      (isInitialState || identityChanged || authenticationChanged) &&
      !recoveryLinkError &&
      !pendingPasswordResetCode
    ) {
      state.currentView = resolveAuthEntryView({
        restored: initialAuthResolved,
        hasUser: Boolean(user),
        requiresEmailVerification,
        isAuthenticated: eligibleForAuthenticatedSocket,
        isRecoveryFlow: Boolean(recoveryLinkError || pendingPasswordResetCode),
      });
    }
    render();
    if (eligibleForAuthenticatedSocket && socket.connected) loadNotifications();
  });
  void authService?.restoreSession().then(({ requiresEmailVerification }) => {
    initialAuthResolved = true;
    const user = firebaseClient?.currentUser ?? null;
    const eligibleForAuthenticatedSocket = Boolean(
      user?.emailVerified && user.providerData.length > 0,
    );
    authViewState.verificationRequired = requiresEmailVerification;
    authViewState.userEmail = requiresEmailVerification ? null : user?.email ?? null;
    authViewState.isAuthenticated = eligibleForAuthenticatedSocket;
    if (requiresEmailVerification && user?.email) {
      authViewState.email = user.email;
    }
    if (!recoveryLinkError && !pendingPasswordResetCode) {
      state.currentView = resolveAuthEntryView({
        restored: true,
        hasUser: Boolean(user),
        requiresEmailVerification,
        isAuthenticated: eligibleForAuthenticatedSocket,
        isRecoveryFlow: Boolean(recoveryLinkError || pendingPasswordResetCode),
      });
    }
    render();
    if (eligibleForAuthenticatedSocket && socket.connected) loadNotifications();
  }).catch((error: unknown) => {
    initialAuthResolved = true;
    if (!recoveryLinkError && !pendingPasswordResetCode) {
      state.currentView = "email-auth";
    }
    authViewState.errorMessage = getAuthErrorMessage(error);
    render();
  });
}

socket.on("lobby-state", (lobby: LobbyState) => {
  applyLobbyState(lobby);
});

socket.on("public-rooms-updated", (payload: PublicRoomsResponse) => {
  if (state.currentView !== "public-rooms" || !Array.isArray(payload.rooms)) return;
  publicRoomsRequestId += 1;
  state.isLoadingPublicRooms = false;
  state.publicRoomsError = null;
  const pendingRoomId = state.pendingPublicRoomId;
  const selectionInvalidated = reconcilePublicRooms(state, payload.rooms);
  render();
  if (selectionInvalidated && pendingRoomId) {
    focusPublicRoomJoin(pendingRoomId);
  }
});

socket.on("removed-from-room", (payload: { roomCode?: string; reason?: string; message?: string }) => {
  if (!payload || payload.roomCode !== state.roomCode || payload.reason !== "kicked") return;
  if (state.game) retiredGameSessionIds.add(state.game.sessionId);
  state.currentView = "home";
  state.roomCode = null;
  state.localPlayerId = null;
  state.lobby = null;
  state.game = null;
  state.pendingKickPlayerId = null;
  state.pendingHostTransferId = null;
  state.selectedPlayerId = null;
  state.invitationMessage = null;
  state.isBusy = false;
  state.isInvitationBusy = false;
  state.isSendingResultsReminder = false;
  clearResultsReminderSuccess();
  clearInvitationFeedback();
  clearPlayerActionFeedback();
  state.errorMessage = payload.message ?? "The host removed you from this room.";
  state.errorCode = "REMOVED_FROM_ROOM";
  resetFakeAnswerViewState();
  render();
});

socket.on(
  "game-starting",
  (payload: {
    roomCode: string;
    lobby: LobbyState;
    game?: GameSessionState;
  }) => {
    if (payload.roomCode !== state.roomCode) {
      return;
    }
    applyLobbyState(payload.lobby);
    if (payload.game) {
      applyGameState(payload.game);
    }
  },
);

socket.on("game-state", (game: GameSessionState) => {
  applyGameState(game);
});

socket.on("results-return-reminder", (payload: { sessionId: string }) => {
  if (state.game?.sessionId !== payload.sessionId || state.currentView !== "game") return;
  state.resultsReminderSessionId = payload.sessionId;
  render();
});

let connectionWasLost = false;
let hasConnectedOnce = false;
socket.on("connect", () => {
  retrySocketWithFreshIdToken.reset();
  state.connectionStatus = "connected";
  state.errorMessage = hasConnectedOnce && connectionWasLost
    ? "Connection restored. Create or join a room to continue."
    : null;
  state.errorCode = null;
  connectionWasLost = false;
  hasConnectedOnce = true;
  render();
  requestAvailableGames();
  if (state.currentView === "public-rooms") subscribeToPublicRooms();
  if (authViewState.isAuthenticated) loadNotifications();
});

socket.on("disconnect", () => {
  connectionWasLost = true;
  state.connectionStatus = "disconnected";
  const wasBrowsingPublicRooms = state.currentView === "public-rooms";
  state.currentView = wasBrowsingPublicRooms ? "public-rooms" : "home";
  state.roomCode = null;
  state.localPlayerId = null;
  state.lobby = null;
  state.game = null;
  state.isSendingResultsReminder = false;
  clearResultsReminderSuccess();
  resetFakeAnswerViewState();
  state.isBusy = false;
  state.errorMessage = "Connection lost. Reconnect to create or join a room.";
  state.isLoadingPublicRooms = false;
  clearPublicRoomSelection();
  clearResultsReminderSuccess();
  clearInvitationFeedback();
  clearPlayerActionFeedback();
  if (wasBrowsingPublicRooms) state.publicRoomsError = "Connection lost. Reconnect to browse public rooms.";
  state.errorCode = null;
  render();
});

socket.on("connect_error", (error) => {
  connectionWasLost = true;
  state.connectionStatus = "disconnected";
  state.isBusy = false;
  if (error.message === "Invalid or expired access token.") {
    void retrySocketWithFreshIdToken.refreshAndReconnect().then((retried) => {
      if (retried) return;
      state.errorMessage =
        "Your Firebase ID token was rejected. Refresh your sign-in and try again.";
      state.errorCode = null;
      render();
    });
  } else {
    state.errorMessage = error.message === "Authentication verification is temporarily unavailable."
      ? "The server could not verify your Firebase sign-in right now. Check the server's Firebase Admin configuration and try again."
      : "Unable to connect to the server. Retrying…";
  }
  if (state.currentView === "public-rooms") {
    state.isLoadingPublicRooms = false;
    clearPublicRoomSelection();
    state.publicRoomsError = "Unable to connect. Reconnect to browse public rooms.";
  }
  state.errorCode = null;
  render();
});

render();
if (socket.connected) requestAvailableGames();
