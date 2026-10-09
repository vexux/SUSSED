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
let fakeAnswerHasVoted = false;
let fakeAnswerIsVoting = false;
let fakeAnswerSelectedOptionId: string | null = null;
let fakeAnswerVoteError: string | null = null;
let fakeAnswerIsContinuing = false;
let fakeAnswerContinueError: string | null = null;
let fakeAnswerIsReturningToLobby = false;
let fakeAnswerReturnToLobbyError: string | null = null;
const retiredGameSessionIds = new Set<string>();

function resetFakeAnswerViewState(): void {
  fakeAnswerHasSubmitted = false;
  fakeAnswerIsSubmitting = false;
  fakeAnswerErrorMessage = null;
  fakeAnswerHasVoted = false;
  fakeAnswerIsVoting = false;
  fakeAnswerSelectedOptionId = null;
  fakeAnswerVoteError = null;
  fakeAnswerIsContinuing = false;
  fakeAnswerContinueError = null;
  fakeAnswerIsReturningToLobby = false;
  fakeAnswerReturnToLobbyError = null;
}

function render(): void {
  renderApp(appRoot, state, actions, {
    hasSubmitted: fakeAnswerHasSubmitted,
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
  });
}

function showOperationError(response: RoomOperationResponse): void {
  state.isBusy = false;
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

function currentFakeAnswerRoundId(): string | null {
  if (
    state.game?.gameId !== "fake-answer" ||
    !isFakeAnswerPublicState(state.game.state)
  ) {
    return null;
  }
  return state.game.state.roundId;
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
        showOperationError(response);
        return;
      }
      state.isBusy = false;
      render();
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
      render();
    });
  },
  onSubmitFakeAnswer(completion) {
    const roundId = currentFakeAnswerRoundId();
    if (!roundId || fakeAnswerHasSubmitted || fakeAnswerIsSubmitting) {
      return;
    }

    fakeAnswerErrorMessage = null;
    fakeAnswerIsSubmitting = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:submit",
      { completion, roundId },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        fakeAnswerIsSubmitting = false;
        if (error || !response) {
          fakeAnswerErrorMessage = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerErrorMessage = response.error.message;
        } else if (response.submitted) {
          fakeAnswerHasSubmitted = true;
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
    const roundId = currentFakeAnswerRoundId();
    if (!roundId || fakeAnswerHasVoted || fakeAnswerIsVoting) {
      return;
    }

    fakeAnswerVoteError = null;
    fakeAnswerIsVoting = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:vote",
      { optionId, roundId },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        fakeAnswerIsVoting = false;
        if (error || !response) {
          fakeAnswerVoteError = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerVoteError = response.error.message;
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
    const roundId = currentFakeAnswerRoundId();
    if (!roundId || fakeAnswerIsContinuing) {
      return;
    }

    fakeAnswerContinueError = null;
    fakeAnswerIsContinuing = true;
    render();
    socket.timeout(5000).emit(
      "fake-answer:continue",
      { roundId },
      (error: Error | null, response?: FakeAnswerSubmissionResponse) => {
        fakeAnswerIsContinuing = false;
        if (error || !response) {
          fakeAnswerContinueError = "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerContinueError = response.error.message;
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
    if (fakeAnswerIsReturningToLobby) {
      return;
    }

    fakeAnswerReturnToLobbyError = null;
    fakeAnswerIsReturningToLobby = true;
    render();
    socket.timeout(5000).emit(
      "return-to-lobby",
      (error: Error | null, response?: RoomOperationResponse) => {
        fakeAnswerIsReturningToLobby = false;
        if (error || !response) {
          fakeAnswerReturnToLobbyError =
            "The server did not respond. Please try again.";
        } else if (response.error) {
          fakeAnswerReturnToLobbyError = response.error.message;
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
};

socket.on("lobby-state", (lobby: LobbyState) => {
  applyLobbyState(lobby);
});

socket.on(
  "game-starting",
  (payload: { roomCode: string; lobby: LobbyState }) => {
    if (payload.roomCode !== state.roomCode) {
      return;
    }
    applyLobbyState(payload.lobby);
  },
);

socket.on("game-state", (game: GameSessionState) => {
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
    game.gameId === "fake-answer" &&
    isFakeAnswerPublicState(previousState) &&
    isFakeAnswerPublicState(nextState) &&
    previousState.phase === "answer-submission" &&
    nextState.phase === "answer-submission" &&
    previousState.currentRound === nextState.currentRound &&
    previousState.totalRounds === nextState.totalRounds &&
    previousState.playerCount === nextState.playerCount &&
    previousState.prompt?.id === nextState.prompt?.id &&
    previousState.prompt?.text === nextState.prompt?.text &&
    previousState.submissionCount !== nextState.submissionCount;
  const isVoteProgressOnly =
    state.currentView === "game" &&
    previousGame?.roomCode === game.roomCode &&
    previousGame.gameId === game.gameId &&
    game.gameId === "fake-answer" &&
    isFakeAnswerPublicState(previousState) &&
    isFakeAnswerPublicState(nextState) &&
    previousState.phase === "voting" &&
    nextState.phase === "voting" &&
    previousState.currentRound === nextState.currentRound &&
    previousState.voteCount !== nextState.voteCount &&
    JSON.stringify(previousState.options) === JSON.stringify(nextState.options);
  const isNewGame =
    state.game?.roomCode !== game.roomCode ||
    state.game?.gameId !== game.gameId ||
    state.game?.sessionId !== game.sessionId;
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
    isSubmissionProgressOnly &&
    updateFakeAnswerProgress(appRoot, game.state)
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
