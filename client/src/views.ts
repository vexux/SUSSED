import type { AppState } from "./appState";
import {
  renderFakeAnswerGame,
  type FakeAnswerViewState,
} from "./games/fakeAnswer";

export interface AppActions {
  onPlayerNameChange(name: string): void;
  onCreateRoom(): void;
  onJoinRoom(roomCode: string): void;
  onLeaveRoom(): void;
  onSetReady(isReady: boolean): void;
  onSelectGame(gameId: string): void;
  onStartGame(): void;
  onSubmitFakeAnswer(completion: string): void;
  onSelectVote(optionId: string): void;
  onVoteFakeAnswer(optionId: string): void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createStatus(state: AppState): HTMLElement {
  const status = createElement(
    "span",
    "connection-status",
    state.connectionStatus,
  );
  status.dataset.status = state.connectionStatus;
  return status;
}

function createHeader(state: AppState): HTMLElement {
  const header = createElement("header", "app-header");
  header.append(
    createElement("span", "brand", "SUSSED!"),
    createStatus(state),
  );
  return header;
}

function createErrorMessage(message: string | null): HTMLElement | null {
  if (!message) {
    return null;
  }
  const error = createElement("p", "error-message", message);
  error.setAttribute("role", "alert");
  return error;
}

function renderHome(
  state: AppState,
  actions: AppActions,
): HTMLElement {
  const screen = createElement("section", "app-screen home-screen");
  const title = createElement("h1", undefined, "SUSSED!");
  const introduction = createElement(
    "p",
    "screen-description",
    "Create a room or join your friends in a social deduction game.",
  );
  screen.append(title, introduction);

  const playerNameLabel = createElement("label", "field-label", "Player name");
  playerNameLabel.htmlFor = "player-name";
  const playerNameInput = createElement("input", "text-input");
  playerNameInput.id = "player-name";
  playerNameInput.name = "playerName";
  playerNameInput.type = "text";
  playerNameInput.autocomplete = "name";
  playerNameInput.maxLength = 20;
  playerNameInput.required = true;
  playerNameInput.value = state.playerName;
  playerNameInput.addEventListener("input", () => {
    actions.onPlayerNameChange(playerNameInput.value);
  });

  const identityField = createElement("div", "field");
  identityField.append(playerNameLabel, playerNameInput);
  screen.append(identityField);

  const createButton = createElement("button", "primary-button", "Create room");
  createButton.type = "button";
  createButton.disabled =
    state.connectionStatus !== "connected" || state.isBusy;
  createButton.addEventListener("click", actions.onCreateRoom);

  const createPanel = createElement("div", "action-panel");
  createPanel.append(createButton);

  const joinLabel = createElement("label", "field-label", "Room code");
  joinLabel.htmlFor = "room-code";
  const roomCodeInput = createElement("input", "text-input room-code-input");
  roomCodeInput.id = "room-code";
  roomCodeInput.name = "roomCode";
  roomCodeInput.type = "text";
  roomCodeInput.autocomplete = "off";
  roomCodeInput.maxLength = 4;
  roomCodeInput.placeholder = "ABCD";
  roomCodeInput.setAttribute("aria-label", "Room code");

  const joinButton = createElement("button", "secondary-button", "Join room");
  joinButton.type = "button";
  joinButton.disabled =
    state.connectionStatus !== "connected" || state.isBusy;
  joinButton.addEventListener("click", () => {
    actions.onJoinRoom(roomCodeInput.value);
  });

  const joinPanel = createElement("div", "join-panel");
  const roomCodeField = createElement("div", "field");
  roomCodeField.append(joinLabel, roomCodeInput);
  joinPanel.append(roomCodeField, joinButton);

  const actionsPanel = createElement("div", "room-actions");
  actionsPanel.append(createPanel, joinPanel);
  screen.append(actionsPanel);

  if (state.isBusy) {
    screen.append(createElement("p", "status-message", "Connecting to room…"));
  }
  const error = createErrorMessage(state.errorMessage);
  if (error) {
    screen.append(error);
  }
  return screen;
}

function renderLobby(state: AppState, actions: AppActions): HTMLElement {
  const lobby = state.lobby;
  const screen = createElement("section", "app-screen lobby-screen");
  if (!lobby) {
    return screen;
  }

  const heading = createElement("h1", undefined, "Lobby");
  const roomCode = createElement("p", "lobby-room-code", lobby.roomCode);
  roomCode.setAttribute("aria-label", `Room code ${lobby.roomCode}`);
  const playerCount = createElement(
    "p",
    "player-count",
    `${lobby.playerCount} / 8 players`,
  );
  const localPlayer = lobby.players.find(
    (player) => player.id === state.localPlayerId,
  );
  const isHost = localPlayer?.isHost === true;
  const gameSelection = createElement("div", "field game-selection");
  const gameLabel = createElement("label", "field-label", "Selected game");
  gameLabel.htmlFor = "selected-game";
  if (isHost && lobby.status === "lobby") {
    const gameSelect = createElement("select", "text-input");
    gameSelect.id = "selected-game";
    gameSelect.value = lobby.selectedGameId;
    gameSelect.disabled = state.isBusy;
    for (const game of lobby.availableGames) {
      const option = createElement("option", undefined, game.displayName);
      option.value = game.id;
      gameSelect.append(option);
    }
    gameSelect.addEventListener("change", () => {
      actions.onSelectGame(gameSelect.value);
    });
    gameSelection.append(gameLabel, gameSelect);
  } else {
    gameSelection.append(
      gameLabel,
      createElement("p", "selected-game-name", lobby.selectedGame.displayName),
    );
  }
  gameSelection.append(
    createElement(
      "p",
      "screen-description",
      `Supports ${lobby.selectedGame.minPlayers}–${lobby.selectedGame.maxPlayers} players`,
    ),
  );
  const playerName = createElement(
    "p",
    "local-player-name",
    localPlayer ? `You are ${localPlayer.name}` : "",
  );
  const playerList = createElement("ul", "player-list");

  for (const player of lobby.players) {
    const item = createElement("li", "player-card");
    const name = createElement("span", "player-name", player.name);
    item.append(name);
    if (player.isHost) {
      item.append(createElement("span", "host-badge", "Host"));
    }
    item.append(
      createElement(
        "span",
        player.isReady ? "ready-badge" : "not-ready-badge",
        player.isReady ? "Ready" : "Not ready",
      ),
    );
    if (player.id === state.localPlayerId) {
      item.classList.add("local-player");
    }
    playerList.append(item);
  }

  const leaveButton = createElement("button", "secondary-button", "Leave room");
  leaveButton.type = "button";
  leaveButton.disabled = state.isBusy;
  leaveButton.addEventListener("click", actions.onLeaveRoom);

  const readyButton = createElement(
    "button",
    "secondary-button",
    localPlayer?.isReady ? "Mark not ready" : "Ready",
  );
  readyButton.type = "button";
  readyButton.disabled = state.isBusy || lobby.status !== "lobby";
  readyButton.addEventListener("click", () => {
    actions.onSetReady(!localPlayer?.isReady);
  });

  screen.append(heading, roomCode, playerCount, gameSelection, playerName, playerList);
  if (lobby.status === "lobby") {
    screen.append(readyButton);
  }

  if (isHost) {
    const unreadyPlayers = lobby.players.filter(
      (player) => !player.isHost && !player.isReady,
    );
    let startReason: string | null = null;
    if (lobby.status !== "lobby") {
      startReason = "The game is already starting.";
    } else if (lobby.playerCount < 2) {
      startReason = "At least 2 players are needed to start.";
    } else if (
      lobby.playerCount < lobby.selectedGame.minPlayers ||
      lobby.playerCount > lobby.selectedGame.maxPlayers
    ) {
      startReason =
        `${lobby.selectedGame.displayName} supports ${lobby.selectedGame.minPlayers} to ${lobby.selectedGame.maxPlayers} players.`;
    } else if (unreadyPlayers.length > 0) {
      startReason = "Waiting for all other players to be ready.";
    }

    const startButton = createElement("button", "primary-button", "Start game");
    startButton.type = "button";
    startButton.disabled = state.isBusy || startReason !== null;
    startButton.addEventListener("click", actions.onStartGame);
    screen.append(startButton);
    if (startReason) {
      screen.append(createElement("p", "status-message start-reason", startReason));
    }
  }

  screen.append(leaveButton);
  if (state.isBusy) {
    screen.append(createElement("p", "status-message", "Updating room…"));
  }
  const error = createErrorMessage(state.errorMessage);
  if (error) {
    screen.append(error);
  }
  return screen;
}

function renderStarting(state: AppState): HTMLElement {
  const screen = createElement("section", "app-screen starting-screen");
  screen.append(
    createElement("h1", undefined, "Game starting"),
    createElement("p", "screen-description", "The host has started the game."),
  );
  if (state.roomCode) {
    screen.append(createElement("p", "lobby-room-code", state.roomCode));
  }
  return screen;
}

function renderGame(
  state: AppState,
  actions: AppActions,
  submission: FakeAnswerViewState,
): HTMLElement {
  const game = state.game;
  if (!game) {
    const screen = createElement("section", "app-screen starting-screen");
    screen.append(
      createElement("h1", undefined, "Game starting"),
      createElement("p", "screen-description", "Waiting for the server game state…"),
    );
    return screen;
  }

  switch (game.gameId) {
    case "fake-answer":
      return renderFakeAnswerGame(
        game.state,
        submission,
        actions.onSubmitFakeAnswer,
        actions.onSelectVote,
        actions.onVoteFakeAnswer,
      );
    default: {
      const screen = createElement("section", "app-screen starting-screen");
      screen.append(
        createElement("h1", undefined, game.displayName),
        createElement("p", "screen-description", "This game is starting."),
      );
      return screen;
    }
  }
}

export function renderApp(
  root: HTMLElement,
  state: AppState,
  actions: AppActions,
  fakeAnswerSubmission: FakeAnswerViewState,
): void {
  const shell = createElement("main", "app-shell");
  shell.append(createHeader(state));
  shell.append(
    state.currentView === "starting"
      ? renderStarting(state)
      : state.currentView === "game"
        ? renderGame(state, actions, fakeAnswerSubmission)
        : state.currentView === "lobby"
        ? renderLobby(state, actions)
        : renderHome(state, actions),
  );
  root.replaceChildren(shell);
}
