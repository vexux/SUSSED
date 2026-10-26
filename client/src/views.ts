import type { AppState, LobbyPlayer } from "./appState.ts";
import type { AuthFormMode } from "./auth.ts";
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
  onOpenEmailAuth(): void;
  onPlayAsGuest(): void;
  onBackToWelcome(): void;
  onBrowsePublicRooms(): void;
  onRefreshPublicRooms(): void;
  onJoinPublicRoom(roomId: string): void;
  onContinuePublicRoomJoin(): void;
  onCancelPublicRoomJoin(): void;
  onBackFromPublicRooms(): void;
  onJoinRoom(roomCode: string): void;
  onLeaveRoom(): void;
  onSetRoomVisibility(visibility: "public" | "private"): void;
  onRequestKickPlayer(playerId: string): void;
  onRequestHostTransfer(playerId: string): void;
  onConfirmKickPlayer(): void;
  onConfirmHostTransfer(): void;
  onCancelKickPlayer(): void;
  onOpenPlayerCard(playerId: string): void;
  onClosePlayerCard(): void;
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
  onAuthModeChange(mode: AuthFormMode): void;
  onAuthFieldChange(field: "email" | "password" | "passwordConfirmation", value: string): void;
  onAuthSubmit(): void;
  onAuthGoogle(): void;
  onAuthResendVerification(): void;
  onAuthSignOut(): void;
  onNavigateAccount(view: "profile" | "friends" | "achievements"): void;
  onBackFromAccount(): void;
  onBackFromPublicProfile(): void;
  onProfileDisplayNameChange(displayName: string): void;
  onProfileHandleChange(handle: string): void;
  onCopyProfileHandle(): void;
  onSearchModeChange(mode: "handle" | "displayName"): void;
  onSearchProfiles(mode: "handle" | "displayName", query: string): void;
  onOpenPublicProfile(handle: string): void;
  onSendFriendRequest(handle: string): void;
  onRespondToFriendRequest(requestId: string, action: "accept" | "decline"): void;
  onCancelFriendRequest(requestId: string): void;
  onRemoveFriend(handle: string): void;
}

export interface PublicProfile {
  displayName: string;
  handle: string;
}

export interface SocialViewState {
  profile: (PublicProfile & { handleChangeAvailableAt: string | null }) | null;
  selectedProfile: PublicProfile | null;
  friends: PublicProfile[];
  incomingRequests: Array<PublicProfile & { requestId: string }>;
  outgoingRequests: Array<PublicProfile & { requestId: string }>;
  searchMode: "handle" | "displayName";
  searchQuery: string;
  searchResults: PublicProfile[];
  isLoading: boolean;
  isBusy: boolean;
  errorMessage: string | null;
  statusMessage: string | null;
}

export interface AuthViewState {
  mode: AuthFormMode;
  email: string;
  password: string;
  passwordConfirmation: string;
  userEmail: string | null;
  isAuthenticated: boolean;
  isBusy: boolean;
  errorMessage: string | null;
  statusMessage: string | null;
  verificationRequired: boolean;
  resendAvailableAt: number | null;
  hasRecoverySession: boolean;
  configurationError: string | null;
  recoveryError: string | null;
}

const lobbyPopoverRoots = new WeakSet<HTMLElement>();

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

type IconName = "sun" | "moon" | "copy" | "check" | "close" | "users" | "game" | "globe" | "lock" | "crown" | "key" | "refresh" | "chevron" | "switch" | "door" | "user";

function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add(`icon-${name}`);
  const paths: Record<typeof name, string> = {
    sun: "M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.88-9.88 1.42-1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
    copy: "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
    check: "m5 12 4 4L19 6",
    close: "m18 6-12 12M6 6l12 12",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.87M14 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    game: "M6 11h4m-2-2v4m7-1h.01M18 10h.01M7 6h10a4 4 0 0 1 3.9 3.1l1 5A3 3 0 0 1 17 17l-2-2H9l-2 2a3 3 0 0 1-4.9-2.9l1-5A4 4 0 0 1 7 6Z",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    crown: "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Zm2 15h16",
    key: "M21 2 11 12m0 0a5 5 0 1 1-7.1 7.1A5 5 0 0 1 11 12Zm3-3 3 3m-6 0 3 3",
    refresh: "M21 2v6h-6M21 13a9 9 0 1 1-2.64-6.36L21 8",
    chevron: "m6 9 6 6 6-6",
    switch: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3",
    door: "M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M14 3l5 2v14l-5 2M14 3v18m-5-9h.01m12 0H11m4-4 4 4-4 4",
    user: "M20 21a8 8 0 0 0-16 0m8-10a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
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

function createGoogleIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("google-mark");
  const paths = [
    ["#EA4335", "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"],
    ["#4285F4", "M46.98 24.55c0-1.57-.14-3.08-.4-4.55H24v9.02h12.89c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.38 38.02 46.98 31.8 46.98 24.55Z"],
    ["#34A853", "M24 48c6.48 0 11.93-2.15 15.9-5.8l-7.73-6c-2.15 1.45-4.9 2.3-8.17 2.3-6.27 0-11.58-4.22-13.48-9.91l-7.98 6.19C6.5 42.62 14.62 48 24 48Z"],
    ["#FBBC05", "M10.52 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.77-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.96-6.19Z"],
  ] as const;
  for (const [color, pathData] of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", color);
    svg.append(path);
  }
  return svg;
}

function createNameEntry(state: AppState, inputId: string, actions: AppActions): HTMLElement {
  const field = createElement("div", "field name-entry-field");
  const label = createElement("label", "field-label", "Player name");
  label.htmlFor = inputId;
  const input = createElement("input", "text-input");
  input.id = inputId;
  input.name = "playerName";
  input.type = "text";
  input.autocomplete = "name";
  input.placeholder = "Your name";
  input.required = true;
  input.value = state.playerName;
  if (state.nameEntryError) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${inputId}-error`);
  }
  input.addEventListener("input", () => actions.onPlayerNameChange(input.value));
  field.append(label, input);
  if (state.nameEntryError) {
    const error = createElement("p", "error-message inline-name-error", state.nameEntryError);
    error.id = `${inputId}-error`;
    error.setAttribute("role", "alert");
    field.append(error);
  }
  return field;
}

function appendWordmark(target: HTMLElement): void {
  target.setAttribute("aria-label", "SUSSED!");
  target.append(
    createElement("span", undefined, "SUSSED"),
    createElement("span", "wordmark-exclamation", "!"),
  );
}

function getPlayerInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

function createStatus(state: AppState): HTMLElement {
  const status = createElement(
    "span",
    "connection-status",
    state.connectionStatus,
  );
  status.dataset.status = state.connectionStatus;
  status.setAttribute("aria-label", `Connection ${state.connectionStatus}`);
  return status;
}

function createHeader(
  state: AppState,
  actions: AppActions,
  authState: AuthViewState,
  socialState: SocialViewState,
): HTMLElement {
  const header = createElement("header", "app-header");
  const controls = createElement("div", "header-controls");
  const isEntryView =
    state.currentView === "welcome" ||
    state.currentView === "email-auth" ||
    state.currentView === "auth-loading";
  if (isEntryView) {
    header.classList.add("entry-header");
    if (state.currentView !== "email-auth") {
      header.classList.add("entry-header-controls-only");
    }
  }
  if (state.currentView === "email-auth") {
    const backButton = createElement("button", "text-button auth-back-button", "Back");
    backButton.type = "button";
    backButton.addEventListener("click", actions.onBackToWelcome);
    header.append(backButton);
  }
  if (!isEntryView) {
    const brand = createElement("span", "brand");
    appendWordmark(brand);
    header.append(brand);
  }
  const targetTheme = state.theme === "dark" ? "light" : "dark";
  const themeButton = createElement("button", "theme-toggle");
  const themeIcons = createElement("span", "theme-toggle-icons");
  const sunIcon = createIcon("sun");
  sunIcon.classList.add("theme-toggle-sun");
  const moonIcon = createIcon("moon");
  moonIcon.classList.add("theme-toggle-moon");
  themeIcons.append(sunIcon, moonIcon);
  themeButton.append(themeIcons);
  themeButton.type = "button";
  themeButton.setAttribute("aria-label", `Switch to ${targetTheme} theme`);
  themeButton.title = `Switch to ${targetTheme} theme`;
  themeButton.setAttribute("aria-pressed", String(state.theme === "light"));
  themeButton.addEventListener("click", actions.onToggleTheme);
  if (!isEntryView) {
    controls.append(createStatus(state));
    const accountMenu = createElement("details", "account-menu");
    const accountSummary = createElement(
      "summary",
      "account-menu-trigger",
      authState.isAuthenticated ? "" : "Guest",
    );
    accountSummary.setAttribute(
      "aria-label",
      authState.isAuthenticated ? "Open account menu" : "Guest account menu",
    );
    accountSummary.append(createIcon("user"));
    accountMenu.append(accountSummary);
    const menu = createElement("div", "account-menu-items");
    menu.setAttribute("role", "group");
    menu.setAttribute(
      "aria-label",
      authState.isAuthenticated ? "Account navigation" : "Guest account navigation",
    );
    if (authState.isAuthenticated) {
      for (const [view, label] of [
        ["profile", "Profile"],
        ["friends", "Friends"],
        ["achievements", "Achievements"],
      ] as const) {
        const item = createElement("button", "account-menu-item", label);
        item.type = "button";
        item.disabled = socialState.isBusy;
        item.addEventListener("click", () => actions.onNavigateAccount(view));
        menu.append(item);
      }
      const signOut = createElement("button", "account-menu-item", "Sign out");
      signOut.type = "button";
      signOut.disabled = authState.isBusy || socialState.isBusy;
      signOut.addEventListener("click", actions.onAuthSignOut);
      menu.append(signOut);
    } else {
      const signIn = createElement("button", "account-menu-item", "Sign in");
      signIn.type = "button";
      signIn.addEventListener("click", actions.onOpenEmailAuth);
      menu.append(signIn);
    }
    accountMenu.append(menu);
    controls.append(accountMenu);
  }
  controls.append(themeButton);
  header.append(controls);
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

function createFloatingNotification(message: string, className: string): HTMLElement {
  const notification = createElement(
    "p",
    `floating-notification floating-notification-success ${className}`,
  );
  notification.setAttribute("role", "status");
  notification.setAttribute("aria-live", "polite");
  const icon = createIcon("check");
  icon.classList.add("floating-notification-icon");
  notification.append(icon, createElement("span", undefined, message));
  return notification;
}

function renderWelcome(
  state: AppState,
  actions: AppActions,
  authState: AuthViewState,
): HTMLElement {
  const screen = createElement("section", "app-screen welcome-screen");
  const content = createElement("div", "welcome-content");
  const title = createElement("h1", "welcome-wordmark");
  appendWordmark(title);
  const tagline = createElement(
    "p",
    "welcome-tagline",
    state.landingTagline,
  );
  const buttons = createElement("div", "welcome-actions");
  buttons.setAttribute("aria-label", "Get started");

  const google = createElement("button", "welcome-button welcome-google-button");
  google.type = "button";
  google.disabled = authState.isBusy;
  google.append(createGoogleIcon(), createElement("span", undefined, "Continue with Google"));
  google.addEventListener("click", actions.onAuthGoogle);

  const email = createElement(
    "button",
    "primary-button welcome-button welcome-email-button",
    "Continue with email",
  );
  email.type = "button";
  email.disabled = authState.isBusy;
  email.addEventListener("click", actions.onOpenEmailAuth);

  const guest = createElement(
    "button",
    "secondary-button welcome-button guest-entry-button",
    "Play as a guest",
  );
  guest.type = "button";
  guest.disabled = authState.isBusy;
  guest.addEventListener("click", actions.onPlayAsGuest);

  buttons.append(google, email, guest);
  content.append(title, tagline, buttons);
  screen.append(content);
  const message = authState.errorMessage ?? state.errorMessage;
  if (message) {
    const error = createErrorMessage(message);
    if (error) screen.append(error);
  }
  return screen;
}

function renderEmailAuthentication(
  actions: AppActions,
  authState: AuthViewState,
): HTMLElement {
  const screen = createElement("section", "app-screen email-auth-screen");
  const title = createElement("h1", "email-auth-title", "Continue with email");
  title.tabIndex = -1;
  screen.append(title, renderAuthenticationPanel(authState, actions));
  return screen;
}

function renderAuthLoading(): HTMLElement {
  const screen = createElement("section", "app-screen auth-loading-screen");
  const message = createElement("p", "auth-loading-message", "Checking your sign-in…");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  screen.append(message);
  return screen;
}

function renderAccountBackButton(
  actions: AppActions,
  label = "Back to game",
  onBack: () => void = actions.onBackFromAccount,
): HTMLButtonElement {
  const backButton = createElement("button", "text-button account-screen-back", label);
  backButton.type = "button";
  backButton.addEventListener("click", onBack);
  return backButton;
}

function appendSocialFeedback(screen: HTMLElement, socialState: SocialViewState): void {
  if (socialState.isLoading) {
    const loading = createElement("p", "status-message", "Loading…");
    loading.setAttribute("role", "status");
    screen.append(loading);
  }
  if (socialState.errorMessage) {
    const error = createErrorMessage(socialState.errorMessage);
    if (error) screen.append(error);
  }
  if (socialState.statusMessage) {
    const status = createElement("p", "status-message", socialState.statusMessage);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    screen.append(status);
  }
}

function renderProfileScreen(
  actions: AppActions,
  socialState: SocialViewState,
): HTMLElement {
  const screen = createElement("section", "app-screen account-screen profile-screen");
  screen.append(renderAccountBackButton(actions));
  screen.append(createElement("h1", "account-screen-title", "Profile"));
  if (socialState.profile) {
    const profile = socialState.profile;
    const displayNameLabel = createElement("label", "field-label", "Display name");
    displayNameLabel.htmlFor = "profile-display-name";
    const displayNameInput = createElement("input", "text-input");
    displayNameInput.id = "profile-display-name";
    displayNameInput.name = "displayName";
    displayNameInput.type = "text";
    displayNameInput.autocomplete = "name";
    displayNameInput.minLength = 2;
    displayNameInput.maxLength = 20;
    displayNameInput.required = true;
    displayNameInput.value = profile.displayName;
    const displayNameSave = createElement("button", "primary-button", "Save display name");
    displayNameSave.type = "button";
    displayNameSave.disabled = socialState.isBusy;
    displayNameSave.addEventListener("click", () =>
      actions.onProfileDisplayNameChange(displayNameInput.value),
    );
    const displayNameForm = createElement("div", "account-edit-row");
    const displayNameField = createElement("div", "field");
    displayNameField.append(displayNameLabel, displayNameInput);
    displayNameForm.append(displayNameField, displayNameSave);
    screen.append(displayNameForm);

    const handleLabel = createElement("label", "field-label", "Unique handle");
    handleLabel.htmlFor = "profile-handle";
    const handleInput = createElement("input", "text-input");
    handleInput.id = "profile-handle";
    handleInput.name = "handle";
    handleInput.type = "text";
    handleInput.autocomplete = "off";
    handleInput.minLength = 3;
    handleInput.maxLength = 20;
    handleInput.pattern = "[A-Za-z0-9]{3,20}";
    handleInput.value = profile.handle;
    const handleChange = createElement("button", "secondary-button", "Change handle");
    handleChange.type = "button";
    handleChange.disabled = socialState.isBusy;
    handleChange.addEventListener("click", () => actions.onProfileHandleChange(handleInput.value));
    const handleField = createElement("div", "field");
    handleField.append(handleLabel, handleInput);
    const handleRow = createElement("div", "account-edit-row");
    handleRow.append(handleField, handleChange);
    screen.append(handleRow);
    if (profile.handleChangeAvailableAt) {
      const availableAt = new Date(profile.handleChangeAvailableAt);
      const cooldown = createElement(
        "p",
        "helper-text handle-cooldown",
        availableAt.getTime() > Date.now()
          ? `You can change your handle again ${new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(availableAt)}.`
          : "Your handle can be changed now.",
      );
      screen.append(cooldown);
    } else {
      screen.append(createElement("p", "helper-text handle-cooldown", "You can change your handle now."));
    }
    const publicId = createElement("div", "profile-public-id");
    const publicIdText = createElement("span", undefined, `@${profile.handle}`);
    const copy = createElement("button", "text-button copy-profile-handle", "Copy");
    copy.type = "button";
    copy.setAttribute("aria-label", `Copy handle @${profile.handle}`);
    copy.addEventListener("click", actions.onCopyProfileHandle);
    publicId.append(publicIdText, copy);
    screen.append(publicId);
  }
  appendSocialFeedback(screen, socialState);
  return screen;
}

function appendPublicProfileCard(
  target: HTMLElement,
  profile: PublicProfile,
  actions: AppActions,
  buttonText = "View profile",
): void {
  const card = createElement("article", "social-profile-card");
  const name = createElement("span", "social-profile-name", profile.displayName);
  const handle = createElement("span", "social-profile-handle", `@${profile.handle}`);
  const open = createElement("button", "text-button social-profile-open", buttonText);
  open.type = "button";
  open.addEventListener("click", () => actions.onOpenPublicProfile(profile.handle));
  card.append(name, handle, open);
  target.append(card);
}

function renderFriendsScreen(
  actions: AppActions,
  socialState: SocialViewState,
): HTMLElement {
  const screen = createElement("section", "app-screen account-screen friends-screen");
  screen.append(renderAccountBackButton(actions));
  screen.append(createElement("h1", "account-screen-title", "Friends"));

  const searchForm = createElement("form", "player-search-form");
  const searchLabel = createElement("label", "field-label", "Find players");
  searchLabel.htmlFor = "player-search";
  const searchInput = createElement("input", "text-input");
  searchInput.id = "player-search";
  searchInput.name = "query";
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.maxLength = 20;
  searchInput.placeholder = socialState.searchMode === "handle" ? "@handle" : "Display name";
  searchInput.value = socialState.searchQuery;
  const searchMode = createElement("div", "search-mode-toggle");
  searchMode.setAttribute("role", "group");
  searchMode.setAttribute("aria-label", "Search mode");
  for (const [mode, label] of [
    ["handle", "Exact handle"],
    ["displayName", "Display name"],
  ] as const) {
    const button = createElement("button", "text-button search-mode-button", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(socialState.searchMode === mode));
    button.addEventListener("click", () => actions.onSearchModeChange(mode));
    searchMode.append(button);
  }
  const submit = createElement("button", "primary-button", "Search");
  submit.type = "submit";
  submit.disabled = socialState.isBusy;
  const searchField = createElement("div", "field");
  searchField.append(searchLabel, searchInput);
  searchForm.append(searchField, searchMode, submit);
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.onSearchProfiles(socialState.searchMode, searchInput.value);
  });
  screen.append(searchForm);

  if (socialState.searchResults.length > 0) {
    screen.append(createElement("h2", "social-section-title", "Search results"));
    for (const result of socialState.searchResults) {
      appendPublicProfileCard(screen, result, actions);
      if (result.handle !== socialState.profile?.handle) {
        const request = createElement("button", "secondary-button social-request-button", "Add friend");
        request.type = "button";
        request.disabled = socialState.isBusy;
        request.addEventListener("click", () => actions.onSendFriendRequest(result.handle));
        screen.append(request);
      }
    }
  } else if (
    socialState.searchQuery &&
    !socialState.isLoading &&
    !socialState.isBusy &&
    !socialState.errorMessage
  ) {
    screen.append(createElement("p", "empty-state", "No players found."));
  }

  const friendsHeading = createElement("h2", "social-section-title", "Friends");
  screen.append(friendsHeading);
  if (socialState.friends.length === 0) {
    screen.append(createElement("p", "empty-state", "No friends yet."));
  } else {
    for (const friend of socialState.friends) {
      appendPublicProfileCard(screen, friend, actions);
      const remove = createElement("button", "text-button social-remove-friend", "Remove friend");
      remove.type = "button";
      remove.disabled = socialState.isBusy;
      remove.addEventListener("click", () => actions.onRemoveFriend(friend.handle));
      screen.append(remove);
    }
  }

  const incomingHeading = createElement("h2", "social-section-title", "Incoming Requests");
  screen.append(incomingHeading);
  if (socialState.incomingRequests.length === 0) {
    screen.append(createElement("p", "empty-state", "No incoming requests."));
  }
  for (const request of socialState.incomingRequests) {
    appendPublicProfileCard(screen, request, actions);
    const buttons = createElement("div", "social-request-actions");
    for (const [action, label] of [["accept", "Accept"], ["decline", "Decline"]] as const) {
      const button = createElement("button", action === "accept" ? "primary-button" : "text-button", label);
      button.type = "button";
      button.disabled = socialState.isBusy;
      button.addEventListener("click", () => actions.onRespondToFriendRequest(request.requestId, action));
      buttons.append(button);
    }
    screen.append(buttons);
  }

  screen.append(createElement("h2", "social-section-title", "Sent Requests"));
  if (socialState.outgoingRequests.length === 0) {
    screen.append(createElement("p", "empty-state", "No sent requests."));
  }
  for (const request of socialState.outgoingRequests) {
    appendPublicProfileCard(screen, request, actions);
    const cancel = createElement("button", "text-button social-cancel-request", "Cancel request");
    cancel.type = "button";
    cancel.disabled = socialState.isBusy;
    cancel.addEventListener("click", () => actions.onCancelFriendRequest(request.requestId));
    screen.append(cancel);
  }
  appendSocialFeedback(screen, socialState);
  return screen;
}

function renderPublicProfileScreen(
  actions: AppActions,
  socialState: SocialViewState,
): HTMLElement {
  const screen = createElement("section", "app-screen account-screen public-profile-screen");
  screen.append(renderAccountBackButton(actions, "Back to friends", actions.onBackFromPublicProfile));
  screen.append(createElement("h1", "account-screen-title", "Player"));
  if (socialState.selectedProfile) {
    appendPublicProfileCard(screen, socialState.selectedProfile, actions);
    if (socialState.selectedProfile.handle !== socialState.profile?.handle) {
      const add = createElement("button", "primary-button", "Add friend");
      add.type = "button";
      add.disabled = socialState.isBusy;
      add.addEventListener("click", () =>
        actions.onSendFriendRequest(socialState.selectedProfile!.handle),
      );
      screen.append(add);
    }
  }
  appendSocialFeedback(screen, socialState);
  return screen;
}

function renderAchievementsScreen(actions: AppActions): HTMLElement {
  const screen = createElement("section", "app-screen account-screen achievements-screen");
  screen.append(renderAccountBackButton(actions));
  screen.append(
    createElement("h1", "account-screen-title", "Achievements"),
    createElement("p", "empty-state", "No achievements yet."),
  );
  return screen;
}

function renderHome(
  state: AppState,
  actions: AppActions,
): HTMLElement {
  const screen = createElement("section", "app-screen home-screen");
  screen.append(createElement("h1", "game-home-title", "Play"));

  const playerNameLabel = createElement("label", "field-label", "Player name");
  playerNameLabel.htmlFor = "player-name";
  const playerNameInput = createElement("input", "text-input");
  playerNameInput.id = "player-name";
  playerNameInput.name = "playerName";
  playerNameInput.type = "text";
  playerNameInput.autocomplete = "name";
  playerNameInput.required = true;
  playerNameInput.value = state.playerName;
  playerNameInput.addEventListener("input", () => {
    actions.onPlayerNameChange(playerNameInput.value);
  });

  const identityField = createElement("div", "field landing-name-field");
  identityField.append(playerNameLabel, playerNameInput);
  screen.append(identityField);
  if (state.errorCode === "DUPLICATE_PLAYER_NAME") {
    const duplicateNameError = createErrorMessage(state.errorMessage);
    if (duplicateNameError) {
      duplicateNameError.classList.add("duplicate-name-error");
      screen.append(duplicateNameError);
    }
  }

  const createPanel = createElement("section", "landing-action-card");
  const createHeading = createElement("h2", "landing-action-heading");
  createHeading.append(createIcon("game"), createElement("span", undefined, "Create a room"));
  const createButton = createElement("button", "primary-button", "Choose a game");
  createButton.type = "button";
  createButton.disabled = state.connectionStatus !== "connected" || state.isBusy || state.availableGames.length === 0;
  createButton.addEventListener("click", actions.onCreateRoom);
  createPanel.append(createHeading, createButton);

  const joinPanel = createElement("section", "landing-action-card");
  const joinHeading = createElement("h2", "landing-action-heading");
  joinHeading.append(createIcon("key"), createElement("span", undefined, "Join with code"));
  joinPanel.append(joinHeading);
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

  const roomCodeField = createElement("div", "field");
  roomCodeField.append(joinLabel, roomCodeInput);
  joinPanel.append(roomCodeField, joinButton);

  const browsePanel = createElement("section", "landing-action-card");
  const browseHeading = createElement("h2", "landing-action-heading");
  browseHeading.append(createIcon("users"), createElement("span", undefined, "Browse public rooms"));
  const browseButton = createElement("button", "secondary-button browse-public-rooms", "Browse public rooms");
  browseButton.type = "button";
  browseButton.disabled = state.connectionStatus !== "connected" || state.isBusy;
  browseButton.addEventListener("click", actions.onBrowsePublicRooms);
  browsePanel.append(browseHeading, browseButton);
  const actionsPanel = createElement("div", "landing-actions");
  actionsPanel.setAttribute("aria-label", "Room actions");
  actionsPanel.append(createPanel, joinPanel, browsePanel);
  screen.append(actionsPanel);
  if (state.invitationMessage) {
    const invitationMessage = createElement("p", "invitation-message", state.invitationMessage);
    invitationMessage.setAttribute("role", state.joinRoomCode ? "status" : "alert");
    screen.append(invitationMessage);
  }
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

function renderAuthenticationPanel(
  state: AuthViewState,
  actions: AppActions,
): HTMLElement {
  const panel = createElement("section", "auth-panel");
  panel.setAttribute("aria-labelledby", "auth-panel-title");
  const title = createElement(
    "h2",
    "landing-action-heading",
    "Sign in or create an account",
  );
  title.id = "auth-panel-title";
  panel.append(title);

  if (state.configurationError) {
    const error = createErrorMessage(state.configurationError);
    if (error) panel.append(error);
  } else {
    if (state.mode !== "recovery" && state.mode !== "forgot-password") {
      const modeChoices = createElement("div", "auth-mode-choices");
      for (const [mode, label] of [
        ["sign-in", "Sign in"],
        ["sign-up", "Create account"],
      ] as const) {
        const button = createElement(
          "button",
          mode === state.mode ? "secondary-button is-selected" : "secondary-button",
          label,
        );
        button.type = "button";
        button.disabled = state.isBusy;
        button.setAttribute("aria-pressed", String(mode === state.mode));
        button.addEventListener("click", () => actions.onAuthModeChange(mode));
        modeChoices.append(button);
      }
      panel.append(modeChoices);
    }

    const form = createElement("form", "auth-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      actions.onAuthSubmit();
    });

    const addField = (
      field: "email" | "password" | "passwordConfirmation",
      labelText: string,
      type: "email" | "password",
      value: string,
      autocomplete: "email" | "new-password" | "current-password",
    ) => {
      const fieldContainer = createElement("div", "field");
      const label = createElement("label", "field-label", labelText);
      const input = createElement("input", "text-input");
      input.id = `auth-${field}`;
      input.name = field;
      input.type = type;
      input.autocomplete = autocomplete;
      input.required = true;
      input.value = value;
      if (type === "password") input.minLength = 8;
      label.htmlFor = input.id;
      input.addEventListener("input", () =>
        actions.onAuthFieldChange(field, input.value),
      );
      fieldContainer.append(label, input);
      form.append(fieldContainer);
    };

    if (state.mode === "recovery") {
      const heading = createElement(
        "p",
        "auth-help-text",
        state.recoveryError ??
          (state.isBusy
            ? "Checking your recovery link…"
            : state.hasRecoverySession
              ? "Choose a new password for your account."
              : "The recovery link is invalid or expired. Request a new recovery email."),
      );
      panel.append(heading);
      if (state.hasRecoverySession) {
        addField("password", "New password", "password", state.password, "new-password");
        addField(
          "passwordConfirmation",
          "Confirm new password",
          "password",
          state.passwordConfirmation,
          "new-password",
        );
        form.append(createAuthSubmitButton(
          state.isBusy ? "Updating password…" : "Update password",
          state.isBusy,
        ));
        panel.append(form);
      } else {
        const requestLink = createElement(
          "button",
          "secondary-button",
          "Request a new recovery email",
        );
        requestLink.type = "button";
        requestLink.disabled = state.isBusy;
        requestLink.addEventListener("click", () => {
          actions.onAuthModeChange("forgot-password");
        });
        panel.append(requestLink);
      }
    } else {
      if (state.mode === "forgot-password") {
        panel.append(createElement(
          "p",
          "auth-help-text",
          "We’ll email you a link to reset your password.",
        ));
      }
      addField("email", "Email", "email", state.email, "email");
      if (state.mode !== "forgot-password") {
        addField(
          "password",
          "Password",
          "password",
          state.password,
          state.mode === "sign-up" ? "new-password" : "current-password",
        );
      }
      form.append(createAuthSubmitButton(
        state.isBusy
          ? "Please wait…"
          : state.mode === "forgot-password"
            ? "Send recovery email"
            : state.mode === "sign-up"
              ? "Create account"
              : "Sign in",
        state.isBusy,
      ));
      panel.append(form);

      if (state.mode === "sign-in") {
        const forgot = createElement("button", "auth-text-button", "Forgot password?");
        forgot.type = "button";
        forgot.disabled = state.isBusy;
        forgot.addEventListener("click", () =>
          actions.onAuthModeChange("forgot-password"),
        );
        panel.append(forgot);
      }
      if (state.mode === "forgot-password") {
        const back = createElement("button", "auth-text-button", "Back to sign in");
        back.type = "button";
        back.disabled = state.isBusy;
        back.addEventListener("click", () => actions.onAuthModeChange("sign-in"));
        panel.append(back);
      }
      if (state.mode !== "forgot-password") {
        const divider = createElement("p", "auth-divider", "or");
        const google = createElement("button", "secondary-button auth-google-button");
        google.append(
          createGoogleIcon(),
          createElement("span", undefined, state.isBusy ? "Please wait…" : "Continue with Google"),
        );
        google.type = "button";
        google.disabled = state.isBusy;
        google.addEventListener("click", actions.onAuthGoogle);
        panel.append(divider, google);
      }
    }

    if (state.verificationRequired) {
      const resend = createElement(
        "button",
        "auth-text-button",
        state.resendAvailableAt && state.resendAvailableAt > Date.now()
          ? `Resend verification email (${Math.ceil((state.resendAvailableAt - Date.now()) / 1000)}s)`
          : "Resend verification email",
      );
      resend.type = "button";
      resend.disabled = state.isBusy ||
        (state.resendAvailableAt !== null && state.resendAvailableAt > Date.now());
      resend.addEventListener("click", actions.onAuthResendVerification);
      panel.append(resend);
    }
  }

  if (state.errorMessage) {
    const error = createErrorMessage(state.errorMessage);
    if (error) panel.append(error);
  }
  if (state.statusMessage) {
    const status = createElement("p", "auth-status-message", state.statusMessage);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.append(status);
  }
  return panel;
}

function createAuthSubmitButton(label: string, disabled: boolean): HTMLButtonElement {
  const button = createElement("button", "primary-button", label);
  button.type = "submit";
  button.disabled = disabled;
  return button;
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
    const title = createElement("span", "visibility-option-title", visibility === "public" ? "Public" : "Private");
    const icon = createIcon(visibility === "public" ? "globe" : "lock");
    icon.classList.add(`room-visibility-icon-${visibility}`);
    title.append(icon);
    content.append(title);
    label.append(input, content);
    choices.append(label);
  }
  field.append(choices);
  return field;
}

function createLobbyVisibilityControl(
  visibility: "public" | "private",
  canChange: boolean,
  isBusy: boolean,
  onChange: (visibility: "public" | "private") => void,
): HTMLElement {
  const label = visibility === "public" ? "Public" : "Private";
  const icon = visibility === "public" ? "globe" : "lock";
  if (!canChange) {
    const value = createElement("span", "room-visibility-pill room-visibility-readonly");
    value.setAttribute("aria-label", `Room visibility: ${label}`);
    const visibilityIcon = createIcon(icon);
    visibilityIcon.classList.add(`room-visibility-icon-${visibility}`);
    value.append(visibilityIcon, createElement("span", undefined, label));
    return value;
  }

  const details = createElement("details", "room-visibility-menu");
  const summary = createElement("summary", "room-visibility-pill");
  summary.setAttribute("aria-label", `Room visibility: ${label}`);
  summary.setAttribute("aria-haspopup", "menu");
  summary.setAttribute("aria-expanded", "false");
  const visibilityIcon = createIcon(icon);
  visibilityIcon.classList.add(`room-visibility-icon-${visibility}`);
  summary.append(visibilityIcon, createElement("span", undefined, label), createIcon("chevron"));
  details.append(summary);

  const menu = createElement("div", "room-visibility-options");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Change room visibility");
  const nextVisibility = visibility === "public" ? "private" : "public";
  const nextLabel = nextVisibility === "public" ? "Make public" : "Make private";
  const option = createElement("button", "room-visibility-menu-action", nextLabel);
  option.type = "button";
  option.setAttribute("role", "menuitem");
  option.disabled = isBusy;
  option.addEventListener("click", () => {
    if (isBusy) return;
    details.open = false;
    onChange(nextVisibility);
  });
  menu.append(option);
  details.append(menu);
  details.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(details.open));
  });
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      details.open = false;
      summary.focus();
    } else if (event.key === "ArrowDown" && event.target === summary) {
      event.preventDefault();
      option.focus();
    } else if (event.key === "ArrowUp" && event.target === option) {
      event.preventDefault();
      summary.focus();
    }
  });
  details.addEventListener("focusout", (event) => {
    const nextTarget = (event as FocusEvent).relatedTarget;
    if (!(nextTarget instanceof Node) || !details.contains(nextTarget)) {
      details.open = false;
    }
  });
  return details;
}

function createGameCard(
  game: AppState["availableGames"][number],
  options: {
    selected: boolean;
    className?: string;
    action?: {
      label: string;
      icon?: IconName;
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
    if (options.action.icon) action.append(createIcon(options.action.icon));
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
  if (!isLobbySelection) {
    screen.append(createNameEntry(state, "selection-player-name", actions));
  }

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
  backButton.disabled = state.isBusy;
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
    createElement("h1", "selection-heading", "Find a table"),
  );

  const controls = createElement("div", "public-room-controls");
  const back = createElement("button", "text-button", "Back");
  back.type = "button";
  back.disabled = state.isBusy;
  back.addEventListener("click", actions.onBackFromPublicRooms);
  const refresh = createElement("button", "secondary-button icon-button public-room-refresh");
  refresh.type = "button";
  refresh.disabled = state.connectionStatus !== "connected" || state.isLoadingPublicRooms;
  refresh.setAttribute("aria-busy", String(state.isLoadingPublicRooms));
  refresh.setAttribute("aria-label", state.isLoadingPublicRooms ? "Refreshing public rooms" : "Refresh public rooms");
  refresh.title = state.isLoadingPublicRooms ? "Refreshing public rooms" : "Refresh public rooms";
  const refreshIcon = createIcon("refresh");
  refreshIcon.classList.add("public-room-refresh-icon");
  refresh.append(refreshIcon);
  refresh.addEventListener("click", actions.onRefreshPublicRooms);
  controls.append(back, refresh);
  screen.append(controls);

  if (state.isLoadingPublicRooms && state.publicRooms.length === 0) {
    const loading = createElement("p", "status-message", "Finding open rooms…");
    loading.setAttribute("role", "status");
    screen.append(loading);
  } else if (state.publicRooms.length === 0 && !state.publicRoomsError) {
    const empty = createElement("div", "public-room-empty");
    empty.append(
      createIcon("users"),
      createElement("p", undefined, "No open rooms yet"),
    );
    screen.append(empty);
  } else {
    const cards = createElement("div", "public-room-grid");
    state.publicRooms.forEach((room) => {
      const card = createElement("article", "public-room-card");
      card.dataset.roomId = room.roomId;
      card.dataset.gameId = room.gameId;
      card.append(createGameCardArt(room.gameId));
      const details = createElement("div", "public-room-details");
      const roomTitle = /s$/iu.test(room.hostName) ? `${room.hostName}' room` : `${room.hostName}'s room`;
      const roomName = createElement("h2", "public-room-room-name", roomTitle);
      const gameName = createElement("p", "public-room-game-title", room.gameName);
      const occupancy = createElement("div", "public-room-occupancy");
      const occupancyText = createElement("p", "game-card-player-count", `${room.playerCount}/${room.maxPlayers} players`);
      const progress = createElement("div", "public-room-occupancy-track");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Room occupancy");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(room.maxPlayers));
      progress.setAttribute("aria-valuenow", String(room.playerCount));
      progress.setAttribute("aria-valuetext", `${room.playerCount} of ${room.maxPlayers} players`);
      const progressFill = createElement("div", "public-room-occupancy-fill");
      const occupancyPercent = Math.min(100, Math.max(0, (room.playerCount / room.maxPlayers) * 100));
      progressFill.style.width = `${occupancyPercent}%`;
      progress.append(progressFill);
      occupancy.append(occupancyText, progress);
      const roomIsFull = room.playerCount >= room.maxPlayers;
      const joinIsExpanded = state.pendingPublicRoomId === room.roomId && !state.isBusy && !roomIsFull;
      const join = createElement(
        "button",
        "primary-button public-room-join",
        state.isBusy ? "Joining…" : roomIsFull ? "Full" : "Join",
      );
      join.type = "button";
      join.disabled = state.connectionStatus !== "connected" || state.isBusy || roomIsFull;
      join.setAttribute("aria-expanded", String(joinIsExpanded));
      if (joinIsExpanded) join.setAttribute("aria-controls", `public-room-name-entry-${room.roomId}`);
      join.addEventListener("click", () => actions.onJoinPublicRoom(room.roomId));
      details.append(roomName, gameName, occupancy, join);
      card.append(details);

      if (joinIsExpanded) {
        const nameEntry = createElement("section", "public-room-name-entry");
        nameEntry.id = `public-room-name-entry-${room.roomId}`;
        nameEntry.setAttribute("aria-label", `Join ${roomTitle}`);
        nameEntry.append(createNameEntry(state, "public-room-player-name", actions));
        const continueJoin = createElement("button", "primary-button public-room-continue-join", "Join room");
        continueJoin.type = "button";
        continueJoin.disabled = state.connectionStatus !== "connected" || state.isBusy;
        continueJoin.addEventListener("click", actions.onContinuePublicRoomJoin);
        const cancelJoin = createElement("button", "text-button public-room-cancel-join", "Cancel");
        cancelJoin.type = "button";
        cancelJoin.disabled = state.isBusy;
        cancelJoin.addEventListener("click", actions.onCancelPublicRoomJoin);
        const joinActions = createElement("div", "public-room-join-actions");
        joinActions.append(continueJoin, cancelJoin);
        nameEntry.append(joinActions);
        card.append(nameEntry);
      }
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
  roomCodeButton.setAttribute("aria-label", state.roomCodeCopied ? `Room code ${lobby.roomCode} copied` : `Copy room code ${lobby.roomCode}`);
  roomCodeButton.title = state.roomCodeCopied ? "Room code copied" : "Copy room code";
  roomCodeButton.append(
    createElement("span", "room-code-label", "Room Code"),
  );
  const roomCodeValue = createElement("span", "room-code-chip-row");
  roomCodeValue.append(
    createElement("span", "room-code-chip-value", lobby.roomCode),
    createIcon(state.roomCodeCopied ? "check" : "copy"),
  );
  roomCodeButton.append(roomCodeValue);
  roomCodeButton.addEventListener("click", actions.onCopyRoomCode);
  const roomCodePanel = createElement("div", "lobby-room-code-panel");
  const invitationActions = createElement("div", "invitation-actions");
  const roomCodeControl = createElement("div", "room-code-control");
  roomCodeControl.append(roomCodeButton);
  const inviteButton = createElement("button", "secondary-button invite-friends-button");
  inviteButton.append(
    createIcon("users"),
    createElement("span", "invite-label-long", "Invite friends"),
    createElement("span", "invite-label-short", "Invite"),
  );
  inviteButton.type = "button";
  inviteButton.disabled = state.isBusy || state.isInvitationBusy;
  inviteButton.addEventListener("click", actions.onOpenInvitationDialog);
  invitationActions.append(roomCodeControl, inviteButton);
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
            label: "Switch game",
            icon: "switch",
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

  const visibilityField = createLobbyVisibilityControl(
    lobby.visibility,
    isHost && lobby.status === "lobby",
    state.isBusy,
    actions.onSetRoomVisibility,
  );

  const orderedPlayers = [...lobby.players].sort((first, second) =>
    Number(second.isHost) - Number(first.isHost));
  for (const player of orderedPlayers) {
    const item = createElement("li", "player-list-item");
    const trigger = createElement("button", `player-card${player.id === state.localPlayerId ? " local-player" : ""}`);
    trigger.type = "button";
    trigger.dataset.playerId = player.id;
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", String(state.selectedPlayerId === player.id));
    const playerStatus = player.isInGame
      ? "in game"
      : player.isHost
        ? "host"
        : player.isReady
          ? "ready"
          : "not ready";
    trigger.setAttribute("aria-label", `${player.name}, ${playerStatus}. View player card.`);
    trigger.addEventListener("click", () => actions.onOpenPlayerCard(player.id));
    const avatar = createElement("span", "player-avatar", getPlayerInitials(player.name));
    avatar.setAttribute("aria-hidden", "true");
    const name = createElement("span", "player-name", player.name);
    if (player.isHost) {
      const crown = createIcon("crown");
      crown.classList.add("host-crown-icon");
      crown.setAttribute("role", "img");
      crown.removeAttribute("aria-hidden");
      crown.setAttribute("aria-label", "Current host");
      crown.setAttribute("title", "Current host");
      name.append(crown);
    }
    const badges = createElement("span", "player-card-badges");
    if (player.isInGame) {
      badges.append(createElement("span", "in-game-badge", "In-game"));
    } else if (!player.isHost) {
      badges.append(createElement(
        "span",
        player.isReady ? "ready-badge" : "not-ready-badge",
        player.isReady ? "Ready" : "Not ready",
      ));
    }
    if (player.isHost) badges.append(createElement("span", "host-badge", "Host"));
    trigger.append(avatar, name, badges);
    item.append(trigger);
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

  let reminderButton: HTMLButtonElement | null = null;
  const headingBar = createElement("div", "lobby-heading-bar");
  headingBar.append(heading, visibilityField);
  screen.append(headingBar, selectedGameCard, roomCodePanel);

  const roundsField = createElement("div", "round-selector");
  roundsField.setAttribute("role", "group");
  roundsField.setAttribute("aria-label", "Rounds");
  const supportsRoundSelection = lobby.selectedGame.supportsRoundSelection !== false;
  const canSelectRounds = isHost && lobby.status === "lobby";
  if (canSelectRounds) {
    roundsField.append(createElement("span", "field-label", "Rounds"));
  }
  if (supportsRoundSelection && canSelectRounds) {
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
      option.disabled = state.isBusy;
      option.addEventListener("click", () => {
        actions.onSelectRoundCount(roundCount, lobby.revision);
      });
      roundOptions.append(option);
    }
    roundsField.append(roundOptions);
  } else if (supportsRoundSelection) {
    roundsField.append(
      createElement("p", "readonly-setting-value", `Number of rounds: ${lobby.selectedRoundCount}`),
    );
  }

  const playerSection = createElement("section", "lobby-panel lobby-player-panel");
  playerSection.setAttribute("aria-labelledby", "lobby-players-title");
  const playersHeading = createElement("h2", "lobby-panel-title", "Players");
  playersHeading.id = "lobby-players-title";
  playerSection.append(playersHeading, playerCount, readinessMessage, playerList);

  const lobbySettingsRow = createElement("div", "lobby-settings-row");
  const lobbyContent = createElement("div", "lobby-content-grid");
  lobbyContent.append(playerSection);
  if (supportsRoundSelection) {
    lobbySettingsRow.append(roundsField);
  }
  if (supportsRoundSelection) screen.append(lobbySettingsRow);
  screen.append(lobbyContent);

  const pendingPlayerId = state.pendingKickPlayerId ?? state.pendingHostTransferId;
  const pendingPlayer = lobby.players.find(({ id }) => id === pendingPlayerId);
  if (
    isHost &&
    lobby.status === "lobby" &&
    pendingPlayer &&
    !pendingPlayer.isHost &&
    pendingPlayer.id !== state.localPlayerId
  ) {
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
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) actions.onCancelKickPlayer();
    });
    const isHostTransfer = state.pendingHostTransferId !== null;
    const title = createElement("h2", undefined, isHostTransfer ? `Make ${pendingPlayer.name} host?` : `Kick ${pendingPlayer.name}?`);
    title.id = "kick-confirmation-title";
    const description = createElement(
      "p",
      "screen-description",
      isHostTransfer
        ? "They'll gain control of this lobby."
        : "They can rejoin with the room code.",
    );
    description.id = "kick-confirmation-description";
    dialog.append(title, description);
    const confirmationActions = createElement("div", "button-group kick-confirmation-actions");
    const cancel = createElement("button", "secondary-button", "Cancel");
    cancel.type = "button";
    cancel.disabled = state.isBusy;
    cancel.id = "kick-confirmation-cancel";
    cancel.addEventListener("click", actions.onCancelKickPlayer);
    const confirm = createElement(
      "button",
      isHostTransfer ? "primary-button" : "destructive-button",
      isHostTransfer ? "Yes" : "Kick!",
    );
    confirm.type = "button";
    confirm.disabled = state.isBusy;
    confirm.id = "kick-confirmation-submit";
    confirm.setAttribute("aria-busy", String(state.isBusy));
    confirm.addEventListener("click", isHostTransfer ? actions.onConfirmHostTransfer : actions.onConfirmKickPlayer);
    confirmationActions.append(cancel, confirm);
    dialog.append(confirmationActions);
    backdrop.append(dialog);
    screen.append(backdrop);
  }

  const selectedPlayer = lobby.players.find(({ id }) => id === state.selectedPlayerId);
  if (selectedPlayer) screen.append(createPlayerDetailDialog(state, selectedPlayer, isHost, actions));

  const lobbyActions = createElement(
    "div",
    `button-group lobby-actions${isHost ? " host-lobby-actions" : ""}`,
  );

  if (!isHost && lobby.status === "lobby") {
    lobbyActions.append(readyButton);
  }
  if (isHost) {
    const startButton = createElement("button", "primary-button", "Start game");
    startButton.type = "button";
    startButton.disabled = state.isBusy || lobby.readinessStatus !== "ready";
    startButton.addEventListener("click", actions.onStartGame);
    lobbyActions.append(startButton);
    if (lobby.reminderSessionId && lobby.status === "lobby") {
      const reminderSent = state.resultsReminderSentSessionId === lobby.reminderSessionId;
      reminderButton = createElement("button", "secondary-button reminder-button");
      reminderButton.type = "button";
      reminderButton.disabled = state.isBusy || state.isSendingResultsReminder;
      reminderButton.setAttribute("aria-busy", String(state.isSendingResultsReminder));
      const reminderIcon = createIcon(reminderSent ? "check" : "users");
      reminderIcon.classList.add("reminder-button-icon");
      reminderButton.append(
        reminderIcon,
        createElement(
          "span",
          undefined,
          state.isSendingResultsReminder
            ? "Sending reminder…"
            : reminderSent
              ? "Reminder sent"
              : "Ask everyone to return to lobby",
        ),
      );
      if (reminderSent) reminderButton.classList.add("reminder-button-sent");
      reminderButton.addEventListener("click", actions.onAskResultsViewersToReturn);
    }
  }

  lobbyActions.append(leaveButton);
  if (reminderButton) lobbyActions.append(reminderButton);
  lobbyContent.append(lobbyActions);
  if (state.isBusy) {
    screen.append(createElement("p", "status-message", "Updating room…"));
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
  const urlRow = createElement("div", "invitation-url-row");
  const copyButton = createElement("button", "secondary-button invitation-copy-button");
  copyButton.type = "button";
  copyButton.disabled = state.isBusy || state.isInvitationBusy;
  copyButton.setAttribute("aria-label", state.invitationFeedback === "Invitation link copied." ? "Invitation link copied" : "Copy invitation link");
  copyButton.title = state.invitationFeedback === "Invitation link copied." ? "Invitation link copied" : "Copy invitation link";
  copyButton.setAttribute("data-invitation-focus", "copy");
  copyButton.append(createIcon(state.invitationFeedback === "Invitation link copied." ? "check" : "copy"));
  copyButton.addEventListener("click", actions.onCopyInvitationLink);
  urlRow.append(url, copyButton);
  dialog.append(urlRow);

  const actionPanel = createElement("div", "invitation-dialog-actions");
  const shareButton = createElement("button", "primary-button", "Share invite");
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
  actionPanel.append(shareButton, qrButton);
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
    const feedback = createElement("p", "invitation-dialog-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const feedbackIcon = createIcon("check");
    feedbackIcon.classList.add("invitation-dialog-feedback-icon");
    feedback.append(feedbackIcon, createElement("span", undefined, state.invitationFeedback));
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

function createPlayerDetailDialog(
  state: AppState,
  player: LobbyPlayer,
  isHost: boolean,
  actions: AppActions,
): HTMLDialogElement {
  const dialog = createElement("dialog", "player-detail-dialog");
  dialog.dataset.playerId = player.id;
  dialog.setAttribute("aria-labelledby", "player-detail-title");
  const header = createElement("div", "player-detail-header");
  const avatar = createElement("span", "player-avatar player-detail-avatar", getPlayerInitials(player.name));
  avatar.setAttribute("aria-hidden", "true");
  const title = createElement("h2", undefined, player.name);
  title.id = "player-detail-title";
  const close = createElement("button", "player-detail-close");
  close.type = "button";
  close.autofocus = true;
  close.setAttribute("aria-label", "Close player card");
  close.setAttribute("data-player-detail-focus", "close");
  close.append(createIcon("close"));
  close.addEventListener("click", actions.onClosePlayerCard);
  header.append(avatar, title, close);
  dialog.append(header);

  const status = createElement("div", "player-detail-status");
  if (player.isInGame) {
    status.append(createElement("span", "in-game-badge", "In-game"));
  } else if (!player.isHost) {
    status.append(createElement("span", player.isReady ? "ready-badge" : "not-ready-badge", player.isReady ? "Ready" : "Not ready"));
  }
  if (player.isHost) status.append(createElement("span", "host-badge", "Host"));
  dialog.append(status);

  if (isHost && state.localPlayerId !== player.id && state.lobby?.status === "lobby") {
    const actionsPanel = createElement("div", "player-detail-actions");
    const makeHost = createElement("button", "secondary-button player-action-button", "Make host");
    makeHost.type = "button";
    makeHost.disabled = state.isBusy;
    makeHost.setAttribute("aria-label", `Make ${player.name} host`);
    makeHost.setAttribute("data-player-detail-focus", "make-host");
    makeHost.append(createIcon("crown"));
    makeHost.addEventListener("click", () => actions.onRequestHostTransfer(player.id));
    const remove = createElement("button", "destructive-button", "Remove from room");
    remove.type = "button";
    remove.disabled = state.isBusy;
    remove.setAttribute("data-player-detail-focus", "remove");
    remove.addEventListener("click", () => actions.onRequestKickPlayer(player.id));
    actionsPanel.append(makeHost, remove);
    dialog.append(actionsPanel);
  }

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.onClosePlayerCard();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    actions.onClosePlayerCard();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && dialog.matches(":modal")) actions.onClosePlayerCard();
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
      const value = (next as unknown as Record<string, unknown>)[property];
      if (property === "maxLength" && typeof value === "number" && value < 0) continue;
      (current as unknown as Record<string, unknown>)[property] = value;
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
  authState: AuthViewState = {
    mode: "sign-in",
    email: "",
    password: "",
    passwordConfirmation: "",
    userEmail: null,
    isBusy: false,
    errorMessage: null,
    statusMessage: null,
    verificationRequired: false,
    resendAvailableAt: null,
    hasRecoverySession: false,
    configurationError: null,
    recoveryError: null,
    isAuthenticated: false,
  },
  socialState: SocialViewState = {
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
  },
): void {
  const previousDialog = root.querySelector<HTMLDialogElement>(".invitation-dialog");
  const previousFocus = root.ownerDocument.activeElement;
  const previousFocusKey =
    previousDialog && previousFocus && previousDialog.contains(previousFocus)
      ? previousFocus.getAttribute("data-invitation-focus")
      : null;
  const previousPlayerDialog = root.querySelector<HTMLDialogElement>(".player-detail-dialog");
  const previousPlayerFocus = root.ownerDocument.activeElement;
  const previousPlayerFocusKey =
    previousPlayerDialog && previousPlayerFocus && previousPlayerDialog.contains(previousPlayerFocus)
      ? previousPlayerFocus.getAttribute("data-player-detail-focus")
      : null;
  const shell = createElement("main", "app-shell");
  shell.append(createHeader(state, actions, authState, socialState));
  const screen =
    state.currentView === "auth-loading"
      ? renderAuthLoading()
      : state.currentView === "welcome"
        ? renderWelcome(state, actions, authState)
      : state.currentView === "email-auth"
        ? renderEmailAuthentication(actions, authState)
      : state.currentView === "profile"
        ? renderProfileScreen(actions, socialState)
      : state.currentView === "friends"
        ? renderFriendsScreen(actions, socialState)
      : state.currentView === "public-profile"
        ? renderPublicProfileScreen(actions, socialState)
      : state.currentView === "achievements"
        ? renderAchievementsScreen(actions)
      : state.currentView === "starting"
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
  if (state.invitationFeedback && !state.isInvitationDialogOpen && !state.roomCodeCopied && state.currentView === "lobby") {
    shell.append(createFloatingNotification(state.invitationFeedback, "invitation-toast"));
  }
  if (state.kickFeedback && state.currentView === "lobby") {
    shell.append(createFloatingNotification(state.kickFeedback, "player-action-toast"));
  }
  if (state.resultsReminderSessionId) {
    const dialog = createElement("dialog", "results-reminder-dialog");
    dialog.setAttribute("aria-labelledby", "results-reminder-title");
    dialog.setAttribute("aria-describedby", "results-reminder-description");
    const title = createElement("h2", undefined, "Return to Lobby?");
    title.id = "results-reminder-title";
    const description = createElement("p", "results-reminder-description", "The host is waiting in the lobby.");
    description.id = "results-reminder-description";
    const heading = createElement("div", "results-reminder-heading");
    const iconBadge = createElement("span", "results-reminder-icon");
    iconBadge.append(createIcon("door"));
    heading.append(iconBadge, title);
    dialog.append(heading, description);
    const actionsPanel = createElement("div", "button-group results-reminder-actions");
    const waitButton = createElement("button", "secondary-button", "Wait");
    waitButton.type = "button";
    waitButton.disabled = state.isBusy;
    waitButton.addEventListener("click", actions.onDismissResultsReminder);
    const returnButton = createElement(
      "button",
      "primary-button",
      state.isBusy ? "Returning…" : "Yes",
    );
    returnButton.type = "button";
    returnButton.autofocus = true;
    returnButton.disabled = state.isBusy;
    returnButton.setAttribute("aria-busy", String(state.isBusy));
    returnButton.addEventListener("click", actions.onAcceptResultsReminder);
    actionsPanel.append(waitButton, returnButton);
    dialog.append(actionsPanel);
    const error = createErrorMessage(state.errorMessage);
    if (error) dialog.append(error);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!state.isBusy) actions.onDismissResultsReminder();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!state.isBusy) actions.onDismissResultsReminder();
    });
    shell.append(dialog);
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
  const playerDialog = root.querySelector<HTMLDialogElement>(".player-detail-dialog");
  if (state.selectedPlayerId && playerDialog) {
    playerDialog.setAttribute("aria-modal", "false");
    if (typeof playerDialog.show === "function") {
      if (!playerDialog.open) playerDialog.show();
    } else {
      playerDialog.setAttribute("open", "");
    }
    if (previousPlayerFocusKey) {
      playerDialog
        .querySelector<HTMLButtonElement>(`[data-player-detail-focus="${previousPlayerFocusKey}"]`)
        ?.focus();
    } else {
      playerDialog.querySelector<HTMLButtonElement>(".player-detail-close")?.focus();
    }
    positionPlayerDetailDialog(root);
  }
  if (!lobbyPopoverRoots.has(root)) {
    lobbyPopoverRoots.add(root);
    root.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const accountMenu = root.querySelector<HTMLDetailsElement>(".account-menu");
      if (accountMenu?.open && !accountMenu.contains(target)) {
        accountMenu.open = false;
      }
      const visibilityMenu = root.querySelector<HTMLDetailsElement>(".room-visibility-menu");
      if (visibilityMenu?.open && !visibilityMenu.contains(target)) {
        visibilityMenu.open = false;
      }
      const activeDialog = root.querySelector<HTMLDialogElement>(".player-detail-dialog");
      if (
        activeDialog?.open &&
        !activeDialog.contains(target) &&
        !target.closest(".player-card")
      ) {
        actions.onClosePlayerCard();
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const accountMenu = root.querySelector<HTMLDetailsElement>(".account-menu");
      if (!accountMenu?.open) return;
      event.preventDefault();
      accountMenu.open = false;
      accountMenu.querySelector<HTMLElement>(".account-menu-trigger")?.focus();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => positionPlayerDetailDialog(root));
      window.addEventListener("scroll", () => positionPlayerDetailDialog(root), true);
      window.visualViewport?.addEventListener("resize", () => positionPlayerDetailDialog(root));
      window.visualViewport?.addEventListener("scroll", () => positionPlayerDetailDialog(root));
    }
  }
  positionPlayerDetailDialog(root);
  const resultsReminderDialog = root.querySelector<HTMLDialogElement>(".results-reminder-dialog");
  if (state.resultsReminderSessionId && resultsReminderDialog) {
    if (typeof resultsReminderDialog.showModal === "function") {
      if (!resultsReminderDialog.open) resultsReminderDialog.showModal();
    } else {
      resultsReminderDialog.setAttribute("open", "");
    }
  }

  function positionPlayerDetailDialog(root: HTMLElement): void {
    if (typeof window === "undefined") return;
    const dialog = root.querySelector<HTMLDialogElement>(".player-detail-dialog");
    if (!dialog?.open) return;
    const trigger = Array.from(root.querySelectorAll<HTMLButtonElement>(".player-card"))
      .find(({ dataset }) => dataset.playerId === dialog.dataset.playerId);
    if (!trigger) return;

    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const margin = 12;
    const gap = 8;
    dialog.style.maxHeight = `${Math.max(120, viewportHeight - margin * 2)}px`;
    dialog.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;

    const anchor = trigger.getBoundingClientRect();
    const card = dialog.getBoundingClientRect();
    const rightSpace = viewportLeft + viewportWidth - anchor.right - gap - margin;
    const leftSpace = anchor.left - viewportLeft - gap - margin;
    let left: number;
    if (rightSpace >= card.width) {
      left = anchor.right + gap;
    } else if (leftSpace >= card.width) {
      left = anchor.left - card.width - gap;
    } else {
      left = Math.max(viewportLeft + margin, Math.min(
        anchor.left,
        viewportLeft + viewportWidth - card.width - margin,
      ));
    }

    const below = anchor.bottom + gap;
    const above = anchor.top - card.height - gap;
    const top = below + card.height <= viewportTop + viewportHeight - margin
      ? below
      : above >= viewportTop + margin
        ? above
        : Math.max(viewportTop + margin, Math.min(
          below,
          viewportTop + viewportHeight - card.height - margin,
        ));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  }
}
