import "./style.css";
import {
  createInitialAppState,
  persistThemePreference,
  type GameSessionState,
  type LobbyGame,
  type LobbyState,
  type PublicRoom,
} from "./appState";
import { socket } from "./socket";
import { renderApp } from "./views";
import type { AppActions } from "./views";
import {
  copyText,
  createInvitationQrDataUrl,
  createInvitationUrl,
  normalizeInvitationCode,
  parseInvitationCode,
  shareOrCopyInvitation,
} from "./invitations";
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

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("The application root element was not found.");
}
const appRoot: HTMLElement = app;

const state = createInitialAppState();
const invitationCode = parseInvitationCode(window.location.search);
if (invitationCode.status === "valid") {
  state.joinRoomCode = invitationCode.code;
  state.invitationMessage = "Invitation code ready. Enter your name, then join the room.";
} else if (invitationCode.status === "invalid") {
  state.invitationMessage = "This invitation link has an invalid room code. You can enter a room code manually.";
}
state.connectionStatus = socket.connected ? "connected" : "connecting";
document.documentElement.dataset.theme = state.theme;
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
if (themeColor) themeColor.content = state.theme === "dark" ? "#17131c" : "#f7f4fa";
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
let resultsReminderFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
let invitationFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
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

function clearResultsReminderFeedback(): void {
  if (resultsReminderFeedbackTimeout) {
    clearTimeout(resultsReminderFeedbackTimeout);
    resultsReminderFeedbackTimeout = null;
  }
  state.resultsReminderFeedback = null;
}

function showResultsReminderFeedback(message: string): void {
  clearResultsReminderFeedback();
  state.resultsReminderFeedback = message;
  resultsReminderFeedbackTimeout = setTimeout(() => {
    state.resultsReminderFeedback = null;
    resultsReminderFeedbackTimeout = null;
    render();
  }, 3500);
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

function render(): void {
  if (state.currentView !== "lobby") {
    state.isInvitationDialogOpen = false;
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
  });
  document.body.classList.toggle(
    "modal-open",
    appRoot.querySelector(".round-feedback-backdrop, .kick-confirmation-backdrop, .invitation-dialog") !== null,
  );
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

function applyPublicRoomsResponse(error: Error | null, response?: PublicRoomsResponse): void {
  state.isLoadingPublicRooms = false;
  if (error || !response || !Array.isArray(response.rooms)) {
    state.publicRoomsError = response?.error?.message ?? "Public rooms could not be loaded. Try again.";
  } else {
    state.publicRooms = response.rooms;
    state.publicRoomsError = null;
  }
  if (state.currentView === "public-rooms") render();
}

function subscribeToPublicRooms(): void {
  state.isLoadingPublicRooms = true;
  state.publicRoomsError = null;
  render();
  socket.timeout(5000).emit("subscribe-public-rooms", applyPublicRoomsResponse);
}

function refreshPublicRooms(): void {
  state.isLoadingPublicRooms = true;
  state.publicRoomsError = null;
  render();
  socket.timeout(5000).emit("refresh-public-rooms", applyPublicRoomsResponse);
}

function unsubscribeFromPublicRooms(): void {
  if (socket.connected) socket.emit("unsubscribe-public-rooms");
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
  if (state.pendingKickPlayerId && !lobby.players.some(({ id }) => id === state.pendingKickPlayerId)) {
    state.pendingKickPlayerId = null;
  }
  state.availableGames = lobby.availableGames;
  state.pendingGameId = null;
  state.errorMessage = null;
  state.errorCode = null;
  state.isBusy = false;
  render();
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
    updateFakeAnswerVoteProgress(appRoot, game.state, state.localPlayerId)
  ) {
    return;
  }
  render();
}

const actions: AppActions = {
  onPlayerNameChange(name) {
    state.playerName = name;
    state.errorMessage = null;
    state.errorCode = null;
  },
  onRoomCodeChange(code) {
    state.joinRoomCode = normalizeInvitationCode(code).slice(0, 4);
    state.invitationMessage = null;
    if (state.errorCode === "INVALID_ROOM_CODE") {
      state.errorMessage = null;
      state.errorCode = null;
    }
  },
  onCreateRoom() {
    state.currentView = "game-selection";
    state.pendingGameId = null;
    state.pendingRoomVisibility = "private";
    state.errorMessage = null;
    state.errorCode = null;
    render();
  },
  onChooseGame(gameId) {
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
    if (gameId !== state.pendingGameId || !state.availableGames.some((game) => game.id === gameId)) return;
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
    state.currentView = state.lobby ? "lobby" : "home";
    state.pendingGameId = null;
    state.errorMessage = null;
    state.errorCode = null;
    render();
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
    document.documentElement.dataset.theme = state.theme;
    if (themeColor) themeColor.content = state.theme === "dark" ? "#17131c" : "#f7f4fa";
    render();
  },
  onBrowsePublicRooms() {
    if (state.connectionStatus !== "connected") return;
    state.currentView = "public-rooms";
    state.publicRoomsError = null;
    state.isLoadingPublicRooms = true;
    subscribeToPublicRooms();
  },
  onRefreshPublicRooms() {
    if (state.connectionStatus === "connected") refreshPublicRooms();
  },
  onJoinPublicRoom(roomId) {
    if (state.connectionStatus !== "connected" || state.isBusy) return;
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
        return;
      }
      if (response.error) {
        state.publicRoomsError = response.error.message;
        render();
        return;
      }
      if (!response.lobby) {
        state.publicRoomsError = "The room joined, but its current state could not be loaded. Refresh and try again.";
        render();
        return;
      }
      unsubscribeFromPublicRooms();
      applyLobbyState(response.lobby);
      },
    );
  },
  onBackFromPublicRooms() {
    unsubscribeFromPublicRooms();
    state.currentView = "home";
    state.publicRoomsError = null;
    state.errorMessage = null;
    render();
  },
  onJoinRoom(roomCode) {
    const normalizedCode = normalizeInvitationCode(roomCode);
    if (!/^[A-Z]{4}$/u.test(normalizedCode)) {
      state.errorMessage = "Enter a four-letter room code.";
      state.errorCode = "INVALID_ROOM_CODE";
      render();
      return;
    }
    state.joinRoomCode = normalizedCode;
    state.invitationMessage = null;
    state.errorMessage = null;
    state.errorCode = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "join-room",
      { roomCode: normalizedCode, playerName: state.playerName },
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
      clearResultsReminderFeedback();
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
  onRequestKickPlayer(playerId) {
    const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
    if (!state.lobby || state.lobby.status !== "lobby" || !localPlayer?.isHost || playerId === state.localPlayerId) return;
    if (!state.lobby.players.some(({ id }) => id === playerId)) return;
    state.pendingKickPlayerId = playerId;
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
        return;
      }
      state.kickFeedback = `${player.name} was removed from the room.`;
      render();
    });
  },
  onCancelKickPlayer() {
    if (state.isBusy) return;
    const cancelledPlayerId = state.pendingKickPlayerId;
    state.pendingKickPlayerId = null;
    render();
    const trigger = Array.from(appRoot.querySelectorAll<HTMLButtonElement>(".kick-player-button"))
      .find((button) => button.dataset.playerId === cancelledPlayerId);
    trigger?.focus();
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
  },
  onCloseInvitationDialog() {
    if (!state.isInvitationDialogOpen) return;
    state.isInvitationDialogOpen = false;
    render();
    appRoot.querySelector<HTMLButtonElement>(".invite-friends-button")?.focus();
  },
  onCopyInvitationLink() {
    const url = state.invitationUrl;
    if (!url) return;
    runInvitationAction(async () => {
      await copyInvitationText(url);
      return "Invitation link copied.";
    });
  },
  onShareInvitationLink() {
    const roomCode = state.lobby?.roomCode;
    const url = state.invitationUrl;
    if (!roomCode || !url) return;
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
    const sessionId = state.lobby?.reminderSessionId;
    if (!sessionId || state.isSendingResultsReminder) return;
    state.errorCode = null;
    state.errorMessage = null;
    clearResultsReminderFeedback();
    state.isSendingResultsReminder = true;
    render();
    socket.timeout(5000).emit(
      "ask-results-viewers-to-return",
      { sessionId },
      (error: Error | null, response?: RoomOperationResponse) => {
        state.isSendingResultsReminder = false;
        if (error || !response) {
          state.errorCode = "SERVER_TIMEOUT";
          state.errorMessage = "The server did not respond. Please try again.";
        } else if (response.error) {
          state.errorCode = response.error.code;
          state.errorMessage = response.error.message;
        } else if (typeof response.sent === "number") {
          const feedback = response.sent === 0
            ? "Everyone has returned."
            : `Reminder sent to ${response.sent} ${response.sent === 1 ? "player" : "players"}.`;
          showResultsReminderFeedback(feedback);
        } else {
          state.errorCode = "INVALID_RESPONSE";
          state.errorMessage = "The reminder result was unclear. Please try again.";
        }
        render();
      },
    );
  },
  onDismissResultsReminder() {
    state.resultsReminderSessionId = null;
    render();
  },
  onAcceptResultsReminder() {
    const sessionId = state.resultsReminderSessionId;
    if (!sessionId) return;
    emitRoomOperation("return-from-results", { sessionId }, (response) => {
      if (response.error) {
        state.resultsReminderSessionId = null;
        state.errorCode = response.error.code;
        state.errorMessage = response.error.message;
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
};

socket.on("lobby-state", (lobby: LobbyState) => {
  applyLobbyState(lobby);
});

socket.on("public-rooms-updated", (payload: PublicRoomsResponse) => {
  if (state.currentView !== "public-rooms" || !Array.isArray(payload.rooms)) return;
  state.publicRooms = payload.rooms;
  state.publicRoomsError = null;
  render();
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
  state.invitationMessage = null;
  state.isBusy = false;
  state.isInvitationBusy = false;
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
  clearResultsReminderFeedback();
  resetFakeAnswerViewState();
  state.isBusy = false;
  state.errorMessage = "Connection lost. Reconnect to create or join a room.";
  state.isLoadingPublicRooms = false;
  if (wasBrowsingPublicRooms) state.publicRoomsError = "Connection lost. Reconnect to browse public rooms.";
  state.errorCode = null;
  render();
});

socket.on("connect_error", () => {
  connectionWasLost = true;
  state.connectionStatus = "disconnected";
  state.isBusy = false;
  state.errorMessage = "Unable to connect to the server. Retrying…";
  if (state.currentView === "public-rooms") {
    state.isLoadingPublicRooms = false;
    state.publicRoomsError = "Unable to connect. Reconnect to browse public rooms.";
  }
  state.errorCode = null;
  render();
});

render();
if (socket.connected) requestAvailableGames();
