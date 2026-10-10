import "./style.css";
import {
  createInitialAppState,
  type GameSessionState,
  type LobbyState,
} from "./appState";
import { socket } from "./socket";
import { renderApp } from "./views";
import type { AppActions } from "./views";
import {
  isFakeAnswerPublicState,
  updateFakeAnswerProgress,
  updateFakeAnswerVoteProgress,
} from "./games/fakeAnswer";

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
  selectedGameId?: string;
  error?: {
    code: string;
    message: string;
  };
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("The application root element was not found.");
}
const appRoot: HTMLElement = app;

const state = createInitialAppState();
state.connectionStatus = socket.connected ? "connected" : "connecting";
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
let fakeAnswerFeedbackDismissedRoundId: string | null = null;
let fakeAnswerFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let fakeAnswerFeedbackTimerKey: string | null = null;
const retiredGameSessionIds = new Set<string>();
const FACT_OR_CAP_GAME_IDS = new Set(["fact-or-cap", "fact-or-cap-anime"]);

function clearRoundFeedbackTimer(): void {
  if (fakeAnswerFeedbackTimer !== null) {
    clearTimeout(fakeAnswerFeedbackTimer);
    fakeAnswerFeedbackTimer = null;
  }
  fakeAnswerFeedbackTimerKey = null;
}

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
  fakeAnswerFeedbackDismissedRoundId = null;
  clearRoundFeedbackTimer();
}

function render(): void {
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
    isReturningToLobby: fakeAnswerIsReturningToLobby,
    returnToLobbyError: fakeAnswerReturnToLobbyError,
    isRoundFeedbackDismissed:
      isFakeAnswerPublicState(state.game?.state) &&
      fakeAnswerFeedbackDismissedRoundId === state.game.state.roundId,
  });
}

function showOperationError(response: RoomOperationResponse): void {
  state.isBusy = false;
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

  if (lobby.status === "lobby") {
    if (state.game) {
      retiredGameSessionIds.add(state.game.sessionId);
    }
    state.game = null;
    resetFakeAnswerViewState();
  }
  state.currentView =
    lobby.status === "lobby"
      ? "lobby"
      : state.game
        ? "game"
        : "starting";
  state.roomCode = lobby.roomCode;
  state.localPlayerId = localPlayer.id;
  state.playerName = localPlayer.name;
  state.lobby = lobby;
  state.errorMessage = null;
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
  const isNewGame =
    state.game?.roomCode !== game.roomCode ||
    state.game?.gameId !== game.gameId ||
    state.game?.sessionId !== game.sessionId;
  if (state.game && isNewGame) {
    retiredGameSessionIds.add(state.game.sessionId);
  }
  const isNewRound =
    !isNewGame &&
    isFakeAnswerPublicState(previousState) &&
    isFakeAnswerPublicState(nextState) &&
    previousState.currentRound !== nextState.currentRound;
  if (isNewGame || isNewRound) {
    resetFakeAnswerViewState();
  }
  state.game = game;
  state.currentView = "game";
  state.errorMessage = null;
  state.isBusy = false;
  if (
    isFakeAnswerPublicState(nextState) &&
    nextState.phase === "results" &&
    fakeAnswerFeedbackDismissedRoundId !== nextState.roundId
  ) {
    const feedbackTimerKey = `${game.sessionId}:${nextState.roundId}`;
    if (fakeAnswerFeedbackTimerKey !== feedbackTimerKey) {
      clearRoundFeedbackTimer();
      fakeAnswerFeedbackTimerKey = feedbackTimerKey;
      fakeAnswerFeedbackTimer = setTimeout(() => {
        fakeAnswerFeedbackTimer = null;
        fakeAnswerFeedbackTimerKey = null;
        if (
          state.game?.sessionId === game.sessionId &&
          isFakeAnswerPublicState(state.game.state) &&
          state.game.state.phase === "results" &&
          state.game.state.roundId === nextState.roundId
        ) {
          fakeAnswerFeedbackDismissedRoundId = nextState.roundId;
          render();
        }
      }, 6000);
    }
  }
  if (
    isSubmissionProgressOnly &&
    updateFakeAnswerProgress(appRoot, game.state, state.localPlayerId)
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
  },
  onCreateRoom() {
    state.errorMessage = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "create-room",
      { playerName: state.playerName },
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
  onJoinRoom(roomCode) {
    state.errorMessage = null;
    state.isBusy = true;
    render();
    emitRoomOperation(
      "join-room",
      { roomCode, playerName: state.playerName },
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
      resetFakeAnswerViewState();
      state.isBusy = false;
      state.errorMessage = null;
      render();
    });
  },
  onSetReady(isReady) {
    state.errorMessage = null;
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
    state.errorMessage = null;
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
  onStartGame() {
    state.errorMessage = null;
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
          fakeAnswerErrorMessage = "Your completion could not be submitted.";
        }
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
  onDismissRoundFeedback() {
    if (isFakeAnswerPublicState(state.game?.state)) {
      clearRoundFeedbackTimer();
      fakeAnswerFeedbackDismissedRoundId = state.game.state.roundId;
      render();
    }
  },
};

socket.on("lobby-state", (lobby: LobbyState) => {
  applyLobbyState(lobby);
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

let connectionWasLost = false;
let hasConnectedOnce = false;
socket.on("connect", () => {
  state.connectionStatus = "connected";
  state.errorMessage = hasConnectedOnce && connectionWasLost
    ? "Connection restored. Create or join a room to continue."
    : null;
  connectionWasLost = false;
  hasConnectedOnce = true;
  render();
});

socket.on("disconnect", () => {
  connectionWasLost = true;
  state.connectionStatus = "disconnected";
  state.currentView = "home";
  state.roomCode = null;
  state.localPlayerId = null;
  state.lobby = null;
  state.game = null;
  resetFakeAnswerViewState();
  state.isBusy = false;
  state.errorMessage = "Connection lost. Reconnect to create or join a room.";
  render();
});

socket.on("connect_error", () => {
  connectionWasLost = true;
  state.connectionStatus = "disconnected";
  state.isBusy = false;
  state.errorMessage = "Unable to connect to the server. Retrying…";
  render();
});

render();
