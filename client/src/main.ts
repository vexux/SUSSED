import "./style.css";
import {
  createInitialAppState,
  type GameSessionState,
  type LobbyState,
} from "./appState";
import { socket } from "./socket";
import { renderApp } from "./views";
import type { AppActions } from "./views";

interface RoomOperationResponse {
  roomCode?: string;
  lobby?: LobbyState;
  left?: boolean;
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

function render(): void {
  renderApp(appRoot, state, actions);
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

  state.currentView = lobby.status === "starting" ? "starting" : "lobby";
  state.roomCode = lobby.roomCode;
  state.localPlayerId = localPlayer.id;
  state.playerName = localPlayer.name;
  state.lobby = lobby;
  state.errorMessage = null;
  state.isBusy = false;
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
  if (game.roomCode !== state.roomCode || game.status !== "active") {
    return;
  }
  state.game = game;
  state.currentView = "game";
  state.errorMessage = null;
  state.isBusy = false;
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
