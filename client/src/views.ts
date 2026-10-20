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
  onRoomCodeChange(code: string): void;
  onCreateRoom(): void;
  onChooseGame(gameId: string): void;
  onChooseRoomVisibility(visibility: "public" | "private"): void;
  onConfirmCreateRoom(gameId: string): void;
  onBackToHome(): void;
  onChooseAnotherGame(): void;
  onToggleTheme(): void;
  onBrowsePublicRooms(): void;
  onRefreshPublicRooms(): void;
  onJoinPublicRoom(roomId: string): void;
  onBackFromPublicRooms(): void;
  onJoinRoom(roomCode: string): void;
  onLeaveRoom(): void;
  onSetRoomVisibility(visibility: "public" | "private"): void;
  onRequestKickPlayer(playerId: string): void;
  onConfirmKickPlayer(): void;
  onCancelKickPlayer(): void;
  onCopyRoomCode(): void;
  onOpenInvitationDialog(): void;
  onCloseInvitationDialog(): void;
  onCopyInvitationLink(): void;
  onShareInvitationLink(): void;
  onToggleInvitationQr(): void;
  onSetReady(isReady: boolean): void;
  onSelectGame(gameId: string): void;
  onSelectRoundCount(roundCount: 5 | 7 | 10, revision: number): void;
  onStartGame(): void;
  onSubmitFakeAnswer(completion: string): void;
  onSubmitBruhAnswer(answer: string): void;
  onBruhAnswerDraftChange(answer: string): void;
  onSelectBruhVote(optionId: string): void;
  onVoteBruhWtf(optionId: string): void;
  onContinueBruhWtf(): void;
  onSelectVote(optionId: string): void;
  onVoteFakeAnswer(optionId: string): void;
  onContinueFakeAnswer(): void;
  onReturnToLobby(): void;
  onReturnFromResults(): void;
  onAskResultsViewersToReturn(): void;
  onDismissResultsReminder(): void;
  onAcceptResultsReminder(): void;
  onDismissRoundFeedback(): void;
  onToggleResultsHistory(): void;
  onResultsHistoryPage(page: number): void;
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

function createIcon(name: "sun" | "moon" | "copy" | "check" | "close"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const paths: Record<typeof name, string> = {
    sun: "M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.88-9.88 1.42-1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
    copy: "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
    check: "m5 12 4 4L19 6",
    close: "m18 6-12 12M6 6l12 12",
  };
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function appendWordmark(target: HTMLElement): void {
  target.setAttribute("aria-label", "SUSSED!");
  target.append(
    createElement("span", undefined, "SUSSED"),
    createElement("span", "wordmark-exclamation", "!"),
  );
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

function createHeader(state: AppState, actions: AppActions): HTMLElement {
  const header = createElement("header", "app-header");
  const brand = createElement("span", "brand");
  appendWordmark(brand);
  const controls = createElement("div", "header-controls");
  const targetTheme = state.theme === "dark" ? "light" : "dark";
  const themeButton = createElement("button", "theme-toggle");
  themeButton.append(createIcon(targetTheme === "light" ? "sun" : "moon"));
  themeButton.type = "button";
  themeButton.setAttribute("aria-label", `Switch to ${targetTheme} theme`);
  themeButton.title = `Switch to ${targetTheme} theme`;
  themeButton.setAttribute("aria-pressed", String(state.theme === "light"));
  themeButton.addEventListener("click", actions.onToggleTheme);
  controls.append(createStatus(state), themeButton);
  header.append(
    brand,
    controls,
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
  const title = createElement("h1", "landing-wordmark");
  appendWordmark(title);
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

  const createButton = createElement("button", "primary-button", "Choose a game");
  createButton.type = "button";
  createButton.disabled = state.connectionStatus !== "connected" || state.isBusy || state.availableGames.length === 0;
  createButton.addEventListener("click", actions.onCreateRoom);

  const createPanel = createElement("div", "action-panel");
  createPanel.append(
    createButton,
    createElement("p", "helper-text", state.availableGames.length === 0 ? "Loading games…" : "Choose a game on the next screen."),
  );

  const joinLabel = createElement("label", "field-label", "Room code");
  joinLabel.htmlFor = "room-code";
  const roomCodeInput = createElement("input", "text-input room-code-input");
  roomCodeInput.id = "room-code";
  roomCodeInput.name = "roomCode";
  roomCodeInput.type = "text";
  roomCodeInput.autocomplete = "off";
  roomCodeInput.maxLength = 4;
  roomCodeInput.placeholder = "CODE";
  roomCodeInput.value = state.joinRoomCode;
  roomCodeInput.required = true;
  roomCodeInput.inputMode = "text";
  roomCodeInput.setAttribute("aria-label", "Room code");
  roomCodeInput.addEventListener("input", () => {
    actions.onRoomCodeChange(roomCodeInput.value);
  });

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
  if (state.invitationMessage) {
    const invitationMessage = createElement("p", "invitation-message", state.invitationMessage);
    invitationMessage.setAttribute("role", state.joinRoomCode ? "status" : "alert");
    screen.append(invitationMessage);
  }
  const browseButton = createElement("button", "secondary-button browse-public-rooms", "Browse public rooms");
  browseButton.type = "button";
  browseButton.disabled = state.connectionStatus !== "connected" || state.isBusy;
  browseButton.addEventListener("click", actions.onBrowsePublicRooms);
  screen.append(browseButton);
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

function createGameCardArt(gameId: string): HTMLElement {
  const illustration = {
    "fact-or-cap": "game-art-fact-or-cap",
    "fact-or-cap-anime": "game-art-fact-or-cap-anime",
    "bruh-wtf": "game-art-bruh-wtf",
  }[gameId] ?? "game-art-generic";
  const art = createElement("div", `game-card-art ${illustration}`);
  art.dataset.gameId = gameId;
  art.setAttribute("aria-hidden", "true");
  art.append(
    createElement("span", "game-art-backdrop"),
    createElement("span", "game-art-object game-art-object-one"),
    createElement("span", "game-art-object game-art-object-two"),
    createElement("span", "game-art-accent"),
  );
  return art;
}

function createVisibilitySelector(options: {
  idPrefix: string;
  visibility: "public" | "private";
  disabled: boolean;
  onChange: (visibility: "public" | "private") => void;
}): HTMLFieldSetElement {
  const field = createElement("fieldset", "visibility-field");
  field.append(createElement("legend", "field-label", "Room visibility"));
  const choices = createElement("div", "visibility-options");
  for (const visibility of ["public", "private"] as const) {
    const label = createElement(
      "label",
      `visibility-option${options.visibility === visibility ? " selected" : ""}`,
    );
    const input = createElement("input");
    input.type = "radio";
    input.id = `${options.idPrefix}-${visibility}`;
    input.name = options.idPrefix;
    input.value = visibility;
    input.checked = options.visibility === visibility;
    input.disabled = options.disabled;
    input.addEventListener("change", () => {
      if (input.checked) options.onChange(visibility);
    });
    const content = createElement("span", "visibility-option-content");
    content.append(
      createElement("span", "visibility-option-title", visibility === "public" ? "Public" : "Private"),
      createElement(
        "span",
        "visibility-option-description",
        visibility === "public" ? "Discoverable while seats are open" : "Join with a room code",
      ),
    );
    label.append(input, content);
    choices.append(label);
  }
  field.append(choices);
  return field;
}

function createGameCard(
  game: AppState["availableGames"][number],
  options: {
    selected: boolean;
    className?: string;
    action?: {
      label: string;
      disabled?: boolean;
      ariaPressed?: boolean;
      onClick: () => void;
    };
  },
): HTMLElement {
  const card = createElement(
    "article",
    `game-card${options.selected ? " selected" : ""}${options.className ? ` ${options.className}` : ""}`,
  );
  card.dataset.gameId = game.id;
  card.append(createGameCardArt(game.id));
  const details = createElement("div", "game-card-details");
  details.append(
    createElement("h2", "game-card-title", game.displayName),
    createElement("p", "game-card-description", game.description),
    createElement(
      "p",
      "game-card-player-count",
      game.maxPlayers === undefined
        ? `${game.minPlayers}+ players`
        : `${game.minPlayers}–${game.maxPlayers} players`,
    ),
  );
  if (options.action) {
    const action = createElement(
      "button",
      options.selected ? "secondary-button game-card-action" : "primary-button game-card-action",
      options.action.label,
    );
    action.type = "button";
    action.disabled = options.action.disabled === true;
    if (options.action.ariaPressed !== undefined) {
      action.setAttribute("aria-pressed", String(options.action.ariaPressed));
    }
    action.addEventListener("click", () => options.action?.onClick());
    details.append(action);
  }
  card.append(details);
  return card;
}

function renderGameSelection(state: AppState, actions: AppActions): HTMLElement {
  const localPlayer = state.lobby?.players.find(({ id }) => id === state.localPlayerId);
  const isLobbySelection = state.lobby !== null;
  const canChangeLobbyGame =
    isLobbySelection && localPlayer?.isHost === true && state.lobby?.status === "lobby";
  const selectedGameId = state.lobby?.selectedGameId ?? state.pendingGameId;
  const screen = createElement("section", "app-screen game-selection-screen");
  screen.append(
    createElement("p", "eyebrow", "MAKE IT A GAME NIGHT"),
    createElement("h1", "selection-heading", isLobbySelection ? "Choose another game" : "Choose your game"),
    createElement(
      "p",
      "screen-description",
      isLobbySelection
        ? "Select a different registered game for this lobby."
        : "Pick the kind of trouble you want to get into.",
    ),
  );

  const cards = createElement("div", "game-card-grid");
  state.availableGames.forEach((game) => {
    const selected = selectedGameId === game.id;
    cards.append(createGameCard(game, {
      selected,
      action: {
        label: selected ? "Selected" : "Select game",
        disabled:
          state.isBusy ||
          state.connectionStatus !== "connected" ||
          selected ||
          (isLobbySelection && !canChangeLobbyGame),
        ariaPressed: selected,
        onClick: () => actions.onChooseGame(game.id),
      },
    }));
  });
  screen.append(cards);

  if (!isLobbySelection) {
    const visibilityField = createVisibilitySelector({
      idPrefix: "create-room-visibility",
      visibility: state.pendingRoomVisibility,
      disabled: state.isBusy,
      onChange: actions.onChooseRoomVisibility,
    });
    visibilityField.classList.add("create-visibility-field");
    screen.append(visibilityField);
  }

  const actionsPanel = createElement("div", "selection-actions");
  const backButton = createElement("button", "text-button", isLobbySelection ? "Back to lobby" : "Back");
  backButton.type = "button";
  backButton.addEventListener("click", actions.onBackToHome);
  actionsPanel.append(backButton);
  if (!isLobbySelection) {
    const createButton = createElement("button", "primary-button create-selected-game", "Create room");
    createButton.type = "button";
    createButton.disabled = !state.pendingGameId || state.isBusy || state.connectionStatus !== "connected";
    createButton.addEventListener("click", () => {
      if (state.pendingGameId) actions.onConfirmCreateRoom(state.pendingGameId);
    });
    actionsPanel.append(createButton);
  }
  screen.append(actionsPanel);

  if (state.isBusy) {
    screen.append(createElement("p", "status-message", isLobbySelection ? "Updating room…" : "Creating your room…"));
  }
  const error = createErrorMessage(state.errorMessage);
  if (error) screen.append(error);
  return screen;
}

function renderPublicRooms(state: AppState, actions: AppActions): HTMLElement {
  const screen = createElement("section", "app-screen public-rooms-screen");
  screen.append(
    createElement("p", "eyebrow", "OPEN TABLES"),
    createElement("h1", "selection-heading", "Browse public rooms"),
    createElement("p", "screen-description", "Join a lobby that is open and has room for you."),
  );

  const controls = createElement("div", "public-room-controls");
  const back = createElement("button", "text-button", "Back");
  back.type = "button";
  back.addEventListener("click", actions.onBackFromPublicRooms);
  const refresh = createElement("button", "secondary-button", state.isLoadingPublicRooms ? "Refreshing…" : "Refresh");
  refresh.type = "button";
  refresh.disabled = state.connectionStatus !== "connected" || state.isLoadingPublicRooms;
  refresh.setAttribute("aria-busy", String(state.isLoadingPublicRooms));
  refresh.addEventListener("click", actions.onRefreshPublicRooms);
  controls.append(back, refresh);
  screen.append(controls);

  if (state.isLoadingPublicRooms && state.publicRooms.length === 0) {
    const loading = createElement("p", "status-message", "Finding open rooms…");
    loading.setAttribute("role", "status");
    screen.append(loading);
  } else if (state.publicRooms.length === 0) {
    const empty = createElement("div", "public-room-empty");
    empty.append(
      createElement("h2", undefined, "No open tables yet"),
      createElement("p", undefined, "Start a room and invite friends, or check back when someone opens a public lobby."),
    );
    const createRoom = createElement("button", "primary-button", "Choose a game");
    createRoom.type = "button";
    createRoom.disabled = state.connectionStatus !== "connected" || state.isBusy;
    createRoom.addEventListener("click", actions.onCreateRoom);
    empty.append(createRoom);
    screen.append(empty);
  } else {
    const cards = createElement("div", "public-room-grid");
    state.publicRooms.forEach((room) => {
      const card = createElement("article", "public-room-card");
      card.dataset.roomId = room.roomId;
      card.dataset.gameId = room.gameId;
      card.append(createGameCardArt(room.gameId));
      const details = createElement("div", "public-room-details");
      details.append(
        createElement("h2", "game-card-title", room.gameName),
        createElement("p", "game-card-description", room.gameDescription),
        createElement("p", "game-card-player-count", `${room.playerCount}/${room.maxPlayers} players`),
      );
      const join = createElement("button", "primary-button public-room-join", state.isBusy ? "Joining…" : "Join");
      join.type = "button";
      join.disabled = state.connectionStatus !== "connected" || state.isBusy;
      join.addEventListener("click", () => actions.onJoinPublicRoom(room.roomId));
      details.append(join);
      card.append(details);
      cards.append(card);
    });
    screen.append(cards);
  }

  if (state.publicRoomsError) {
    const error = createErrorMessage(state.publicRoomsError);
    if (error) screen.append(error);
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
  const roomCodeButton = createElement("button", "room-code-chip");
  roomCodeButton.type = "button";
  roomCodeButton.disabled = state.isBusy || state.isInvitationBusy;
  roomCodeButton.setAttribute("aria-label", `Copy room code ${lobby.roomCode}`);
  roomCodeButton.title = "Copy room code";
  roomCodeButton.append(
    createElement("span", "room-code-chip-value", lobby.roomCode),
    createIcon(state.roomCodeCopied ? "check" : "copy"),
  );
  roomCodeButton.addEventListener("click", actions.onCopyRoomCode);
  const roomCodePanel = createElement("div", "lobby-room-code-panel");
  const invitationActions = createElement("div", "invitation-actions");
  const inviteButton = createElement("button", "primary-button invite-friends-button", "Invite friends");
  inviteButton.type = "button";
  inviteButton.disabled = state.isBusy || state.isInvitationBusy;
  inviteButton.addEventListener("click", actions.onOpenInvitationDialog);
  invitationActions.append(roomCodeButton, inviteButton);
  roomCodePanel.append(invitationActions);
  const playerCount = createElement(
    "p",
    "player-count",
    `${lobby.playerCount} ${lobby.playerCount === 1 ? "player" : "players"} in lobby (${lobby.maxPlayers} max)`,
  );
  const localPlayer = lobby.players.find(
    (player) => player.id === state.localPlayerId,
  );
  const isHost = localPlayer?.isHost === true;
  const selectedGameCard = createGameCard(
    lobby.selectedGame,
    {
      selected: true,
      className: "selected-lobby-game",
      action: isHost && lobby.status === "lobby"
        ? {
            label: "Choose another game",
            disabled: state.isBusy,
            onClick: actions.onChooseAnotherGame,
          }
        : undefined,
    },
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

  let visibilityField: HTMLElement;
  if (isHost && lobby.status === "lobby") {
    visibilityField = createVisibilitySelector({
      idPrefix: "room-visibility",
      visibility: lobby.visibility,
      disabled: state.isBusy,
      onChange: actions.onSetRoomVisibility,
    });
    visibilityField.classList.add("room-visibility-field");
  } else {
    const readOnlyVisibility = createElement("div", "field room-visibility-field");
    readOnlyVisibility.append(createElement("p", "field-label", "Room visibility"));
    readOnlyVisibility.append(createElement(
      "p",
      "selected-game-name",
      lobby.visibility === "public" ? "Public" : "Private",
    ));
    readOnlyVisibility.append(createElement(
      "p",
      "helper-text",
      lobby.visibility === "public"
        ? "Public rooms can be discovered while the lobby has an open slot."
        : "Private rooms are hidden from discovery. Players join with the room code.",
    ));
    visibilityField = readOnlyVisibility;
  }

  for (const player of lobby.players) {
    const item = createElement("li", "player-card");
    const name = createElement("span", "player-name", player.name);
    item.append(name);
    item.append(
      player.isHost
        ? createElement("span", "host-badge", "Host")
        : createElement(
            "span",
            player.isInGame ? "in-game-badge" : player.isReady ? "ready-badge" : "not-ready-badge",
            player.isInGame ? "In-game" : player.isReady ? "Ready" : "Not ready",
          ),
    );
    if (player.id === state.localPlayerId) {
      item.classList.add("local-player");
    }
    if (isHost && lobby.status === "lobby" && !player.isHost) {
      const kickButton = createElement("button", "secondary-button kick-player-button", "Remove");
      kickButton.type = "button";
      kickButton.disabled = state.isBusy;
      kickButton.setAttribute("aria-label", `Remove ${player.name} from room`);
      kickButton.dataset.playerId = player.id;
      kickButton.addEventListener("click", () => actions.onRequestKickPlayer(player.id));
      item.append(kickButton);
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
  readyButton.disabled = state.isBusy || lobby.status !== "lobby" || localPlayer?.isInGame === true;
  readyButton.addEventListener("click", () => {
    actions.onSetReady(!localPlayer?.isReady);
  });

  screen.append(heading, selectedGameCard, roomCodePanel, playerCount, readinessMessage, playerList, visibilityField);
  if (state.kickFeedback) {
    const feedback = createElement("p", "lobby-feedback", state.kickFeedback);
    feedback.setAttribute("role", "status");
    screen.append(feedback);
  }
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

  const kickTarget = lobby.players.find(({ id }) => id === state.pendingKickPlayerId && id !== state.localPlayerId);
  if (isHost && lobby.status === "lobby" && kickTarget) {
    const backdrop = createElement("div", "kick-confirmation-backdrop");
    const dialog = createElement("section", "kick-confirmation");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "kick-confirmation-title");
    dialog.setAttribute("aria-describedby", "kick-confirmation-description");
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        actions.onCancelKickPlayer();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && dialog.ownerDocument.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && dialog.ownerDocument.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    const title = createElement("h2", undefined, "Remove player?");
    title.id = "kick-confirmation-title";
    const description = createElement("p", "screen-description", `Remove ${kickTarget.name} from this room? They may rejoin if they have the room code.`);
    description.id = "kick-confirmation-description";
    dialog.append(title, description);
    const confirmationActions = createElement("div", "button-group kick-confirmation-actions");
    const cancel = createElement("button", "secondary-button", "Cancel");
    cancel.type = "button";
    cancel.disabled = state.isBusy;
    cancel.id = "kick-confirmation-cancel";
    cancel.addEventListener("click", actions.onCancelKickPlayer);
    const confirm = createElement("button", "primary-button", "Remove player");
    confirm.type = "button";
    confirm.disabled = state.isBusy;
    confirm.id = "kick-confirmation-submit";
    confirm.setAttribute("aria-busy", String(state.isBusy));
    confirm.addEventListener("click", actions.onConfirmKickPlayer);
    confirmationActions.append(cancel, confirm);
    dialog.append(confirmationActions);
    backdrop.append(dialog);
    screen.append(backdrop);
  }

  const lobbyActions = createElement("div", "button-group lobby-actions");
  if (lobby.status === "lobby" && !isHost) {
    lobbyActions.append(readyButton);
  }

  if (isHost) {
    const startButton = createElement("button", "primary-button", "Start game");
    startButton.type = "button";
    startButton.disabled = state.isBusy || lobby.readinessStatus !== "ready";
    startButton.addEventListener("click", actions.onStartGame);
    lobbyActions.append(startButton);
    if (lobby.reminderSessionId && lobby.status === "lobby") {
      const reminderButton = createElement("button", "secondary-button reminder-button", "Ask everyone to return to lobby");
      reminderButton.type = "button";
      reminderButton.disabled = state.isSendingResultsReminder;
      reminderButton.setAttribute("aria-busy", String(state.isSendingResultsReminder));
      reminderButton.textContent = state.isSendingResultsReminder
        ? "Sending reminder…"
        : "Ask everyone to return to lobby";
      reminderButton.addEventListener("click", actions.onAskResultsViewersToReturn);
      lobbyActions.append(reminderButton);
    }
  }

  lobbyActions.append(leaveButton);
  screen.append(lobbyActions);
  if (state.isBusy) {
    screen.append(createElement("p", "status-message", "Updating room…"));
  }
  if (state.resultsReminderFeedback) {
    const feedback = createElement("p", "status-message reminder-feedback", state.resultsReminderFeedback);
    feedback.setAttribute("role", "status");
    screen.append(feedback);
  }
  const error = createErrorMessage(state.errorMessage);
  if (error && !state.isInvitationDialogOpen) {
    screen.append(error);
  }
  if (state.isInvitationDialogOpen && state.invitationUrl) {
    screen.append(createInvitationDialog(state, actions, state.invitationUrl));
  }
  return screen;
}

function createInvitationDialog(
  state: AppState,
  actions: AppActions,
  invitationUrl: string,
): HTMLDialogElement {
  const dialog = createElement("dialog", "invitation-dialog");
  dialog.setAttribute("aria-labelledby", "invitation-dialog-title");
  dialog.setAttribute("aria-describedby", "invitation-dialog-description");
  const heading = createElement("div", "invitation-dialog-heading");
  const title = createElement("h2", undefined, "Invite friends");
  title.id = "invitation-dialog-title";
  const closeButton = createElement("button", "invitation-dialog-close");
  closeButton.type = "button";
  closeButton.autofocus = true;
  closeButton.setAttribute("aria-label", "Close invitation dialog");
  closeButton.setAttribute("data-invitation-focus", "close");
  closeButton.addEventListener("click", actions.onCloseInvitationDialog);
  closeButton.append(createIcon("close"));
  heading.append(title, closeButton);
  const description = createElement("p", "invitation-dialog-description", "Share this link with friends to invite them to your room.");
  description.id = "invitation-dialog-description";
  dialog.append(heading, description);

  const url = createElement("p", "invitation-url", invitationUrl);
  url.id = "invitation-url";
  url.setAttribute("aria-label", "Invitation link");
  dialog.append(url);

  const actionPanel = createElement("div", "invitation-dialog-actions");
  const copyButton = createElement("button", "primary-button", state.isInvitationBusy ? "Working…" : "Copy link");
  copyButton.type = "button";
  copyButton.disabled = state.isBusy || state.isInvitationBusy;
  copyButton.setAttribute("data-invitation-focus", "copy");
  copyButton.addEventListener("click", actions.onCopyInvitationLink);
  const shareButton = createElement("button", "secondary-button", "Share invite");
  shareButton.type = "button";
  shareButton.disabled = state.isBusy || state.isInvitationBusy;
  shareButton.setAttribute("data-invitation-focus", "share");
  shareButton.addEventListener("click", actions.onShareInvitationLink);
  const qrButton = createElement("button", "secondary-button", state.isInvitationQrVisible ? "Hide QR code" : "Show QR code");
  qrButton.type = "button";
  qrButton.disabled = state.isBusy || state.isInvitationBusy;
  qrButton.setAttribute("aria-expanded", String(state.isInvitationQrVisible));
  qrButton.setAttribute("data-invitation-focus", "qr");
  qrButton.addEventListener("click", actions.onToggleInvitationQr);
  actionPanel.append(copyButton, shareButton, qrButton);
  dialog.append(actionPanel);

  if (state.isInvitationQrVisible && state.invitationQrDataUrl) {
    const qrImage = createElement("img", "invitation-qr-code");
    qrImage.src = state.invitationQrDataUrl;
    qrImage.alt = "QR code for this room invitation link";
    dialog.append(qrImage);
  }
  if (state.errorMessage) {
    const error = createErrorMessage(state.errorMessage);
    if (error) dialog.append(error);
  }
  if (state.invitationFeedback) {
    const feedback = createElement("p", "invitation-dialog-feedback", state.invitationFeedback);
    feedback.setAttribute("role", "status");
    dialog.append(feedback);
  }
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.onCloseInvitationDialog();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    actions.onCloseInvitationDialog();
  });
  return dialog;
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
        actions.onSelectVote,
        actions.onVoteFakeAnswer,
        actions.onContinueFakeAnswer,
        actions.onReturnToLobby,
        game.displayName,
        game.status === "finished",
        actions.onDismissRoundFeedback,
        actions.onToggleResultsHistory,
        actions.onResultsHistoryPage,
        actions.onReturnFromResults,
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
        actions.onToggleResultsHistory,
        actions.onResultsHistoryPage,
        actions.onReturnFromResults,
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
  const previousDialog = root.querySelector<HTMLDialogElement>(".invitation-dialog");
  const previousFocus = root.ownerDocument.activeElement;
  const previousFocusKey =
    previousDialog && previousFocus && previousDialog.contains(previousFocus)
      ? previousFocus.getAttribute("data-invitation-focus")
      : null;
  const shell = createElement("main", "app-shell");
  shell.append(createHeader(state, actions));
  const screen =
    state.currentView === "starting"
      ? renderStarting(state)
      : state.currentView === "game"
        ? renderGame(state, actions, fakeAnswerSubmission, bruhWtfSubmission)
        : state.currentView === "lobby"
          ? renderLobby(state, actions)
          : state.currentView === "game-selection"
            ? renderGameSelection(state, actions)
          : state.currentView === "public-rooms"
            ? renderPublicRooms(state, actions)
            : renderHome(state, actions);
  screen.dataset.renderScope = getRenderScope(state);
  shell.append(screen);
  if (state.invitationFeedback && !state.isInvitationDialogOpen && state.currentView === "lobby") {
    const toast = createElement("p", "invitation-toast", state.invitationFeedback);
    toast.setAttribute("role", "status");
    shell.append(toast);
  }
  if (state.resultsReminderSessionId) {
    const backdrop = createElement("div", "results-reminder-backdrop");
    const dialog = createElement("section", "results-reminder-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.append(
      createElement("p", undefined, "The host is waiting in the lobby."),
      createElement("h2", undefined, "Return to Lobby?"),
    );
    const actionsPanel = createElement("div", "button-group");
    const waitButton = createElement("button", "secondary-button", "Wait");
    waitButton.type = "button";
    waitButton.addEventListener("click", actions.onDismissResultsReminder);
    const okButton = createElement("button", "primary-button", "OK");
    okButton.type = "button";
    okButton.addEventListener("click", actions.onAcceptResultsReminder);
    actionsPanel.append(waitButton, okButton);
    dialog.append(actionsPanel);
    backdrop.append(dialog);
    shell.append(backdrop);
  }
  // Client invariant: same-scope updates must leave active text entry attached.
  // The shared renderer preserves that control without calling focus; phase,
  // round, session, and view changes use the normal replacement path.
  if (!renderPreservingActiveTextEntry(root, shell)) {
    root.replaceChildren(shell);
  }
  const invitationDialog = root.querySelector<HTMLDialogElement>(".invitation-dialog");
  if (state.isInvitationDialogOpen && invitationDialog) {
    if (typeof invitationDialog.showModal === "function") {
      if (!invitationDialog.open) invitationDialog.showModal();
    } else {
      invitationDialog.setAttribute("open", "");
    }
    if (previousFocusKey) {
      invitationDialog
        .querySelector<HTMLButtonElement>(`[data-invitation-focus="${previousFocusKey}"]`)
        ?.focus();
    }
  }
}
