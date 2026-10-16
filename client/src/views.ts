import type { AppState } from "./appState.ts";
import {
  renderFakeAnswerGame,
  type FakeAnswerViewState,
} from "./games/fakeAnswer.ts";
import {
  renderBruhWtfGame,
  type BruhWtfViewState,
} from "./games/bruhWtf.ts";

export interface AppActions {
  onPlayerNameChange(name: string): void;
  onCreateRoom(): void;
  onJoinRoom(roomCode: string): void;
  onLeaveRoom(): void;
  onSetReady(isReady: boolean): void;
  onSelectGame(gameId: string): void;
  onSelectRoundCount(roundCount: 5 | 7 | 10, revision: number): void;
  onStartGame(): void;
  onSubmitFakeAnswer(completion: string): void;
  onFakeAnswerDraftChange(completion: string): void;
  onSubmitBruhAnswer(answer: string): void;
  onBruhAnswerDraftChange(answer: string): void;
  onSelectBruhVote(optionId: string): void;
  onVoteBruhWtf(optionId: string): void;
  onContinueBruhWtf(): void;
  onSelectVote(optionId: string): void;
  onVoteFakeAnswer(optionId: string): void;
  onContinueFakeAnswer(): void;
  onReturnToLobby(): void;
  onDismissRoundFeedback(): void;
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
    "screen-description landing-tagline",
    state.landingTagline,
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
  if (state.errorCode === "DUPLICATE_PLAYER_NAME") {
    const duplicateNameError = createErrorMessage(state.errorMessage);
    if (duplicateNameError) {
      duplicateNameError.classList.add("duplicate-name-error");
      screen.append(duplicateNameError);
    }
  }

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
  roomCodeInput.placeholder = "CODE";
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
  const error = state.errorCode === "DUPLICATE_PLAYER_NAME"
    ? null
    : createErrorMessage(state.errorMessage);
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
    `${lobby.playerCount} ${lobby.playerCount === 1 ? "player" : "players"} in lobby`,
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
    gameSelect.disabled = state.isBusy;
    for (const game of lobby.availableGames) {
      const option = createElement("option", undefined, game.displayName);
      option.value = game.id;
      gameSelect.append(option);
    }
    gameSelect.value = lobby.selectedGameId;
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
      lobby.selectedGame.description,
    ),
    createElement(
      "p",
      "screen-description",
      lobby.selectedGame.maxPlayers === undefined
        ? `Supports ${lobby.selectedGame.minPlayers}+ players`
        : `Supports ${lobby.selectedGame.minPlayers}–${lobby.selectedGame.maxPlayers} players`,
    ),
  );
  const readinessText =
    lobby.readinessStatus === "insufficient-players"
      ? `At least ${lobby.selectedGame.minPlayers} players are required to start.`
      : lobby.readinessStatus === "waiting-for-ready"
        ? "Waiting for everyone to be ready..."
        : lobby.readinessStatus === "ready"
          ? "Everyone's ready! Start!"
          : "The game is starting...";
  const readinessMessage = createElement(
    "p",
    "lobby-readiness-status",
    readinessText,
  );
  readinessMessage.setAttribute("role", "status");
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

  screen.append(heading, roomCode, playerCount, gameSelection, readinessMessage, playerList);

  const roundsField = createElement("fieldset", "round-selector");
  roundsField.append(createElement("legend", "field-label", "Rounds"));
  const roundOptions = createElement("div", "round-options");
  for (const roundCount of [5, 7, 10] as const) {
    const option = createElement(
      "button",
      `round-option${lobby.selectedRoundCount === roundCount ? " selected" : ""}`,
      String(roundCount),
    );
    option.type = "button";
    option.setAttribute("aria-label", `${roundCount} rounds`);
    option.setAttribute("aria-pressed", String(lobby.selectedRoundCount === roundCount));
    option.disabled = !isHost || lobby.status !== "lobby" || state.isBusy;
    option.addEventListener("click", () => {
      actions.onSelectRoundCount(roundCount, lobby.revision);
    });
    roundOptions.append(option);
  }
  roundsField.append(roundOptions);
  screen.append(roundsField);

  const lobbyActions = createElement("div", "button-group lobby-actions");
  if (lobby.status === "lobby") {
    lobbyActions.append(readyButton);
  }

  if (isHost) {
    const startButton = createElement("button", "primary-button", "Start game");
    startButton.type = "button";
    startButton.disabled = state.isBusy || lobby.readinessStatus !== "ready";
    startButton.addEventListener("click", actions.onStartGame);
    lobbyActions.append(startButton);
  }

  lobbyActions.append(leaveButton);
  screen.append(lobbyActions);
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
  bruhWtfSubmission: BruhWtfViewState,
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
    case "fact-or-cap":
    case "fact-or-cap-anime":
      return renderFakeAnswerGame(
        game.state,
        submission,
        actions.onSubmitFakeAnswer,
        actions.onFakeAnswerDraftChange,
        actions.onSelectVote,
        actions.onVoteFakeAnswer,
        actions.onContinueFakeAnswer,
        actions.onReturnToLobby,
        game.displayName,
        game.status === "finished",
        actions.onDismissRoundFeedback,
      );
    case "bruh-wtf":
      return renderBruhWtfGame(
        game.state,
        bruhWtfSubmission,
        actions.onSubmitBruhAnswer,
        actions.onBruhAnswerDraftChange,
        actions.onSelectBruhVote,
        actions.onVoteBruhWtf,
        actions.onContinueBruhWtf,
        actions.onReturnToLobby,
        game.displayName,
        game.status === "finished",
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

function getRenderScope(state: AppState): string {
  if (state.currentView !== "game" || !state.game) {
    return state.currentView === "lobby" && state.lobby
      ? `lobby:${state.lobby.roomCode}`
      : state.currentView;
  }

  const gameState = state.game.state;
  if (!gameState || typeof gameState !== "object") {
    return `game:${state.game.sessionId}:${state.game.gameId}`;
  }
  const value = gameState as Record<string, unknown>;
  const phase = typeof value.phase === "string" ? value.phase : "unknown";
  const round = typeof value.roundId === "string"
    ? value.roundId
    : typeof value.currentRound === "number"
      ? String(value.currentRound)
      : "unknown";
  return `game:${state.game.sessionId}:${state.game.gameId}:${phase}:${round}`;
}

function isTextEntry(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  const tagName = element.tagName.toUpperCase();
  if (tagName === "TEXTAREA") return true;
  if (tagName !== "INPUT") return false;
  return ["text", "search", "url", "tel", "email", "password", "number"].includes(
    (element as HTMLInputElement).type,
  );
}

function findById(root: ParentNode, id: string): HTMLElement | null {
  for (const element of Array.from(root.children) as HTMLElement[]) {
    if (element.id === id) return element;
    const nested = findById(element, id);
    if (nested) return nested;
  }
  return null;
}

function findScreenScope(element: Element): string | null {
  let current: Element | null = element;
  while (current && !current.classList.contains("app-screen")) {
    current = current.parentElement;
  }
  return current ? (current as HTMLElement).dataset.renderScope ?? null : null;
}

function getPath(root: HTMLElement, target: HTMLElement): HTMLElement[] | null {
  const path: HTMLElement[] = [target];
  let current = target;
  while (current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    path.unshift(parent);
    current = parent;
  }
  return path;
}

function syncAttributes(current: HTMLElement, next: HTMLElement, preserveValue: boolean): void {
  const readAttributes = (element: HTMLElement): Array<[string, string]> => {
    const attributes = element.attributes as NamedNodeMap | Record<string, string>;
    return typeof attributes.length === "number"
      ? Array.from(attributes as NamedNodeMap, ({ name, value }) => [name, value])
      : Object.entries(attributes as Record<string, string>);
  };
  const nextAttributes = new Map(readAttributes(next));
  for (const [name] of readAttributes(current)) {
    if (!(preserveValue && name === "value") && !nextAttributes.has(name)) {
      current.removeAttribute(name);
    }
  }
  for (const [name, value] of nextAttributes) {
    if (!(preserveValue && name === "value") && current.getAttribute(name) !== value) {
      current.setAttribute(name, value);
    }
  }
  current.className = next.className;
  current.id = next.id;
  for (const property of [
    "type", "name", "placeholder", "autocomplete", "maxLength", "required",
    "disabled", "readOnly", "checked", "selectedIndex",
  ] as const) {
    if (property in next) {
      (current as unknown as Record<string, unknown>)[property] =
        (next as unknown as Record<string, unknown>)[property];
    }
  }
}

function preserveTextEntryPath(
  current: HTMLElement,
  next: HTMLElement,
  currentPath: HTMLElement[],
  nextPath: HTMLElement[],
  depth = 0,
): void {
  const isTarget = depth === currentPath.length - 1;
  syncAttributes(current, next, isTarget);
  if (isTarget) return;

  const currentPathChild = currentPath[depth + 1];
  const nextPathChild = nextPath[depth + 1];
  const nextChildren = Array.from(next.children) as HTMLElement[];
  const nextPathIndex = nextChildren.indexOf(nextPathChild);

  // Keep the ancestor leading to the active input attached. Replace only its
  // siblings, so a live update cannot detach the focused control from the DOM.
  for (const child of Array.from(current.children)) {
    if (child !== currentPathChild) child.remove();
  }
  for (let index = 0; index < nextPathIndex; index += 1) {
    current.insertBefore(nextChildren[index], currentPathChild);
  }
  for (let index = nextPathIndex + 1; index < nextChildren.length; index += 1) {
    current.append(nextChildren[index]);
  }
  preserveTextEntryPath(
    currentPathChild,
    nextPathChild,
    currentPath,
    nextPath,
    depth + 1,
  );
}

function renderPreservingActiveTextEntry(root: HTMLElement, next: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement;
  if (!isTextEntry(active) || !root.contains(active) || !active.id) return false;

  const candidate = findById(next, active.id);
  if (!isTextEntry(candidate) || candidate.type !== active.type) return false;
  const scope = findScreenScope(active);
  if (!scope || findScreenScope(candidate) !== scope) return false;

  const currentShell = root.firstElementChild as HTMLElement | null;
  if (!currentShell) return false;
  const currentPath = getPath(currentShell, active);
  const nextPath = getPath(next, candidate);
  if (
    !currentPath ||
    !nextPath ||
    currentPath.length !== nextPath.length ||
    currentPath.some((element, index) => element.tagName !== nextPath[index].tagName)
  ) {
    return false;
  }

  const selection = "selectionStart" in active && "selectionEnd" in active
    ? {
      start: active.selectionStart,
      end: active.selectionEnd,
      direction: active.selectionDirection,
    }
    : null;
  preserveTextEntryPath(currentShell, next, currentPath, nextPath);
  if (
    selection &&
    root.ownerDocument.activeElement === active &&
    typeof active.setSelectionRange === "function" &&
    selection.start !== null &&
    selection.end !== null
  ) {
    active.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
  }
  return true;
}

export function renderApp(
  root: HTMLElement,
  state: AppState,
  actions: AppActions,
  fakeAnswerSubmission: FakeAnswerViewState,
  bruhWtfSubmission: BruhWtfViewState,
): void {
  const shell = createElement("main", "app-shell");
  shell.append(createHeader(state));
  const screen =
    state.currentView === "starting"
      ? renderStarting(state)
      : state.currentView === "game"
        ? renderGame(state, actions, fakeAnswerSubmission, bruhWtfSubmission)
        : state.currentView === "lobby"
        ? renderLobby(state, actions)
        : renderHome(state, actions);
  screen.dataset.renderScope = getRenderScope(state);
  shell.append(screen);
  // Client invariant: same-scope updates must leave active text entry attached.
  // The shared renderer preserves that control without calling focus; phase,
  // round, session, and view changes use the normal replacement path.
  if (!renderPreservingActiveTextEntry(root, shell)) {
    root.replaceChildren(shell);
  }
}
