import "./style.css";
import { createInitialAppState, type LobbyState } from "./appState";
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

function render(): void {
  renderApp(appRoot, state, actions);
}

function showOperationError(response: RoomOperationResponse): void {
  state.isBusy = false;
  state.errorMessage =
    response.error?.message ?? "The room operation could not be completed.";
  render();
}

function applyLobbyState(lobby: LobbyState): void {
  const localPlayer = lobby.players.find((player) => player.id === socket.id);
  if (!localPlayer) {
    return;
  }

  state.currentView = "lobby";
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
    socket.emit(
      "create-room",
      { playerName: state.playerName },
      (response: RoomOperationResponse) => {
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
    socket.emit(
      "join-room",
      { roomCode, playerName: state.playerName },
      (response: RoomOperationResponse) => {
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
    socket.emit("leave-room", (response: RoomOperationResponse) => {
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
};

socket.on("lobby-state", (lobby: LobbyState) => {
  applyLobbyState(lobby);
});

socket.on("connect", () => {
  state.connectionStatus = "connected";
  state.errorMessage = null;
  render();
});

socket.on("disconnect", () => {
  state.connectionStatus = "disconnected";
  state.currentView = "home";
  state.roomCode = null;
  state.localPlayerId = null;
  state.lobby = null;
  state.isBusy = false;
  state.errorMessage = "Connection lost. Reconnect to create or join a room.";
  render();
});

render();
