import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialAppState,
  LANDING_TAGLINE,
  persistThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
} from "../src/appState.ts";
import { validatePlayerName } from "../src/playerName.ts";
import { reconcilePublicRooms } from "../src/publicRoomState.ts";
import { renderApp } from "../src/views.ts";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.parentElement = null;
    this.ownerDocument = globalThis.document;
    this.listeners = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.type = "text";
    this._maxLength = -1;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = "none";
    this.style = { width: "" };
    this.classList = {
      add: (...names) => { this.className = `${this.className} ${names.join(" ")}`.trim(); },
      contains: (name) => this.className.split(/\s+/u).includes(name),
    };
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  insertBefore(child, before) {
    child.remove();
    const index = this.children.indexOf(before);
    child.parentElement = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    if (this.ownerDocument?.activeElement && this.contains(this.ownerDocument.activeElement)) {
      this.ownerDocument.activeElement = null;
    }
    this.parentElement = null;
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.ownerDocument.activeElement = this; }
  get maxLength() { return this._maxLength; }
  set maxLength(value) {
    if (value < 0) throw new RangeError("maxLength must not be negative");
    this._maxLength = value;
  }
  setSelectionRange(start, end, direction = "none") {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
  dispatch(type, extra = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...extra }); }
  query(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.query(predicate);
      if (result) return result;
    }
    return null;
  }
  queryAll(predicate) {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.queryAll(predicate)),
    ];
  }
  querySelector(selector) {
    const attributeMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/u);
    if (attributeMatch) {
      return this.query((element) => element.getAttribute(attributeMatch[1]) === attributeMatch[2]);
    }
    if (selector.startsWith("#")) {
      return this.query((element) => element.id === selector.slice(1));
    }
    if (selector.startsWith(".")) {
      return this.query((element) => element.classList.contains(selector.slice(1)));
    }
    return this.query((element) => element.tagName === selector.toLowerCase());
  }
  get firstElementChild() { return this.children[0] ?? null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  get text() { return `${this.textContent}${this.children.map((child) => child.text).join("")}`; }
}

function withFakeDocument(callback) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try { callback(); }
  finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

function createAnswerEntryState(gameId) {
  const state = createInitialAppState();
  state.currentView = "game";
  state.localPlayerId = "local";
  state.game = {
    roomCode: "ABCD",
    sessionId: "session-1",
    gameId,
    displayName: gameId,
    status: "active",
    players: [],
    state: gameId === "bruh-wtf"
      ? {
        phase: "answer-submission",
        currentRound: 1,
        totalRounds: 5,
        roundId: "round-1",
        prompt: "What would Alex do?",
        playerCount: 3,
        submissionCount: 0,
        submissionProgress: [
          { playerId: "local", name: "Alex", submitted: false },
          { playerId: "remote", name: "Sam", submitted: false },
          { playerId: "remote-2", name: "Riley", submitted: false },
        ],
      }
      : {
        phase: "answer-submission",
        currentRound: 1,
        totalRounds: 5,
        roundId: "round-1",
        prompt: { id: "prompt-1", text: "Complete this fact." },
        playerCount: 3,
        submissionCount: 0,
        submissionProgress: [
          { playerId: "local", name: "Alex", submitted: false },
          { playerId: "remote", name: "Sam", submitted: false },
          { playerId: "remote-2", name: "Riley", submitted: false },
        ],
      },
  };
  return state;
}

function createActions() {
  return new Proxy({}, { get: () => () => {} });
}

test("authentication panel renders verification, recovery, OAuth, and signed-in states", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    const root = new FakeElement("root");
    const authState = {
      mode: "sign-up",
      email: "player@example.com",
      password: "",
      passwordConfirmation: "",
      userEmail: null,
      isBusy: false,
      errorMessage: null,
      statusMessage: "Check your inbox for a verification link.",
      verificationRequired: true,
      profileDisplayName: null,
      profileLoading: false,
      profileSaving: false,
      resendAvailableAt: Date.now() + 10_000,
      hasRecoverySession: false,
      configurationError: null,
      recoveryError: null,
    };
    const render = () => renderApp(root, state, createActions(), {}, {}, authState);

    render();
    let panel = root.query((element) => element.classList.contains("auth-panel"));
    assert.ok(panel);
    assert.match(panel.text, /Create account/u);
    assert.match(panel.text, /Continue with Google/u);
    assert.match(panel.text, /Resend verification email/u);
    assert.ok(panel.query((element) => element.id === "auth-email"));

    authState.mode = "recovery";
    authState.userEmail = "player@example.com";
    authState.hasRecoverySession = true;
    render();
    panel = root.query((element) => element.classList.contains("auth-panel"));
    assert.match(panel.text, /Choose a new password/u);
    assert.ok(panel.query((element) => element.id === "auth-passwordConfirmation"));

    authState.mode = "sign-in";
    authState.userEmail = "player@example.com";
    authState.profileDisplayName = "Player one";
    render();
    panel = root.query((element) => element.classList.contains("auth-panel"));
    assert.match(panel.text, /player@example.com/u);
    assert.match(panel.text, /Sign out/u);
    assert.equal(panel.query((element) => element.id === "auth-password"), null);
    assert.equal(panel.query((element) => element.id === "profile-display-name").value, "Player one");
  });
});

function createSubmissionView(gameId) {
  return gameId === "bruh-wtf"
    ? {
      currentPlayerId: "local", answerDraft: "", isSubmitting: false,
      submitError: null, selectedOptionId: null, isVoting: false,
      hasVoted: false, voteError: null, isContinuing: false,
      continueError: null, isHost: false, isReturningToLobby: false,
      returnToLobbyError: null,
    }
    : {
      currentPlayerId: "local", hasSubmitted: false, completionDraft: "",
      isSubmitting: false, submissionError: null, hasVoted: false,
      isVoting: false, selectedOptionId: null, voteError: null,
      isContinuing: false, continueError: null, isHost: false,
      isReturningToLobby: false, returnToLobbyError: null,
      isRoundFeedbackDismissed: true,
    };
}

test("remote game updates preserve active answer inputs in both shared game flows", () => {
  for (const [gameId, inputId] of [
    ["fact-or-cap", "fake-completion"],
    ["fact-or-cap-anime", "fake-completion"],
    ["bruh-wtf", "bruh-answer"],
  ]) {
    withFakeDocument(() => {
      const state = createAnswerEntryState(gameId);
      const submission = createSubmissionView(gameId);
      const root = new FakeElement("root");
      const render = () => renderApp(
        root,
        state,
        createActions(),
        gameId === "bruh-wtf" ? {} : submission,
        gameId === "bruh-wtf" ? submission : {},
      );
      render();

      const input = root.query((element) => element.id === inputId);
      assert.ok(input);
      input.value = "unfinished answer";
      input.selectionStart = 7;
      input.selectionEnd = 7;
      globalThis.document.activeElement = input;

      for (let submittedCount = 1; submittedCount <= 2; submittedCount += 1) {
        const currentState = state.game.state;
        currentState.submissionCount = submittedCount;
        currentState.submissionProgress[submittedCount].submitted = true;
        state.connectionStatus = submittedCount === 1 ? "disconnected" : "connected";
        render();

        assert.equal(root.query((element) => element.id === inputId), input, `${gameId} after remote update ${submittedCount}`);
        assert.equal(globalThis.document.activeElement, input);
        assert.equal(input.value, "unfinished answer");
        assert.equal(input.selectionStart, 7);
        assert.equal(input.selectionEnd, 7);
      }

      // A local submission is a legitimate end to the entry session.
      state.game.state.submissionCount = 3;
      state.game.state.submissionProgress[0].submitted = true;
      state.game.state.submissionProgress[1].submitted = true;
      state.game.state.submissionProgress[2].submitted = true;
      render();
      assert.equal(root.query((element) => element.id === inputId), null);
      assert.equal(globalThis.document.activeElement, null);
    });
  }
});

test("an intentionally blurred text input is not refocused by a later render", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const input = root.query((element) => element.id === "player-name");
    globalThis.document.activeElement = input;
    globalThis.document.activeElement = null;
    state.connectionStatus = "disconnected";
    renderApp(root, state, createActions(), {}, {});
    assert.notEqual(root.query((element) => element.id === "player-name"), input);
    assert.equal(globalThis.document.activeElement, null);
  });
});

test("a new game round starts a fresh answer-entry input", () => {
  withFakeDocument(() => {
    const state = createAnswerEntryState("fact-or-cap");
    const submission = createSubmissionView("fact-or-cap");
    const root = new FakeElement("root");
    const render = () => renderApp(root, state, createActions(), submission, {});
    render();
    const firstRoundInput = root.query((element) => element.id === "fake-completion");
    firstRoundInput.value = "answer from the previous round";
    globalThis.document.activeElement = firstRoundInput;

    state.game.state.roundId = "round-2";
    state.game.state.currentRound = 2;
    state.game.state.submissionCount = 0;
    state.game.state.submissionProgress.forEach((player) => { player.submitted = false; });
    submission.completionDraft = "";
    render();

    const secondRoundInput = root.query((element) => element.id === "fake-completion");
    assert.notEqual(secondRoundInput, firstRoundInput);
    assert.equal(secondRoundInput.value, "");
    assert.equal(globalThis.document.activeElement, null);
  });
});

test("landing page uses a stable tagline and keeps its form interactions usable", () => {
  withFakeDocument(() => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const state = createInitialAppState();
      state.connectionStatus = "connected";
      const selected = state.landingTagline;
      assert.equal(selected, LANDING_TAGLINE);
      Math.random = () => 0;
      assert.equal(createInitialAppState().landingTagline, LANDING_TAGLINE);
      Math.random = () => 0.5;

      state.availableGames = [
        { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
      ];
      const calls = { create: 0, join: [], names: [] };
      const actions = {
        onPlayerNameChange(name) { state.playerName = name; state.errorMessage = null; state.errorCode = null; calls.names.push(name); },
        onCreateRoom() { calls.create += 1; },
        onJoinRoom(code) { calls.join.push(code); },
        onRoomCodeChange(code) { state.joinRoomCode = code.toUpperCase(); },
        onBrowsePublicRooms() { calls.browse = true; },
      };
      const root = new FakeElement("root");
      const render = () => renderApp(root, state, actions, {}, {});
      render();
      const tagline = root.query((element) => element.className.includes("landing-tagline"));
      const nameInput = root.query((element) => element.id === "player-name");
      const codeInput = root.query((element) => element.id === "room-code");
      assert.equal(tagline.textContent, selected);
      assert.equal(codeInput.placeholder, "CODE");
      assert.equal(root.text.includes("Room codes are memorable four-letter words."), false);
      assert.ok(root.query((element) => element.tagName === "button" && element.textContent === "Choose a game"));
      const actionCards = root.query((element) => element.className.includes("landing-actions")).children;
      assert.equal(actionCards.length, 3);
      assert.deepEqual(actionCards.map((card) => card.query((element) => element.tagName === "h2").text), [
        "Create a room", "Join with code", "Browse public rooms",
      ]);
      assert.ok(actionCards.every((card) => card.className.includes("landing-action-card")));
      assert.equal(actionCards[0].query((element) => element.tagName === "svg").attributes["aria-hidden"], "true");

      nameInput.value = "Alex";
      nameInput.dispatch("input");
      render();
      assert.equal(state.landingTagline, selected);
      assert.equal(root.query((element) => element.className.includes("landing-tagline")).textContent, selected);
      assert.equal(root.query((element) => element.id === "player-name").value, "Alex");
      root.query((element) => element.textContent === "Choose a game").dispatch("click");
      root.query((element) => element.id === "room-code").value = "ABCD";
      root.query((element) => element.textContent === "Join room").dispatch("click");
      root.query((element) => element.tagName === "button" && element.textContent === "Browse public rooms").dispatch("click");
      assert.equal(calls.create, 1);
      assert.deepEqual(calls.join, ["ABCD"]);
      assert.deepEqual(calls.names, ["Alex"]);
      assert.equal(calls.browse, true);
    } finally {
      Math.random = originalRandom;
    }
  });
});

test("invitation code is prefilled without automatically joining and remains editable", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.joinRoomCode = "ZING";
    state.invitationMessage = "Invitation code ready. Enter your name, then join the room.";
    let joins = 0;
    const actions = {
      onRoomCodeChange(code) { state.joinRoomCode = code.toUpperCase(); },
      onJoinRoom() { joins += 1; },
    };
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.id === "room-code").value, "ZING");
    assert.equal(root.query((element) => element.className.includes("invitation-message")).attributes.role, "status");
    assert.equal(joins, 0);
    const code = root.query((element) => element.id === "room-code");
    code.value = "beam";
    code.dispatch("input");
    assert.equal(state.joinRoomCode, "BEAM");
    code.selectionStart = 2;
    code.selectionEnd = 2;
    globalThis.document.activeElement = code;
    state.errorMessage = "A room update arrived.";
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.id === "room-code"), code);
    assert.equal(globalThis.document.activeElement, code);
    assert.equal(code.value, "beam");
    assert.equal(code.selectionStart, 2);
    root.query((element) => element.textContent === "Join room").dispatch("click");
    assert.equal(joins, 1);
  });
});

test("malformed invitation information is announced and leaves manual joining available", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.invitationMessage = "This invitation link has an invalid room code. You can enter a room code manually.";
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    assert.equal(root.query((element) => element.className.includes("invitation-message")).attributes.role, "alert");
    assert.ok(root.query((element) => element.id === "room-code"));
    assert.equal(root.query((element) => element.textContent === "Join room").disabled, false);
  });
});

test("lobby offers a room-code chip and invitation dialog while preserving host-only kick actions", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.localPlayerId = "host";
    state.lobby = {
      roomCode: "ZING", revision: 1, playerCount: 2, readinessStatus: "waiting-for-ready",
      status: "lobby", visibility: "private", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 5,
      reminderSessionId: null,
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Game", minPlayers: 2, maxPlayers: 8 },
      availableGames: [],
      players: [
        { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
        { id: "guest", name: "Guest", isHost: false, isReady: false, isInGame: false },
      ],
    };
    const calls = [];
    const actions = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) });
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    const roomCodeButton = root.query((element) => element.className.includes("room-code-chip"));
    assert.equal(roomCodeButton.getAttribute("aria-label"), "Copy room code ZING");
    assert.equal(roomCodeButton.children[0].textContent, "Room Code");
    assert.equal(roomCodeButton.children[1].className, "room-code-chip-row");
    assert.equal(roomCodeButton.children[1].children[0].textContent, "ZING");
    roomCodeButton.dispatch("click");
    const inviteButton = root.query((element) => element.className.includes("invite-friends-button"));
    assert.equal(inviteButton.className.includes("secondary-button"), true);
    assert.equal(inviteButton.children[0].tagName, "svg");
    inviteButton.dispatch("click");
    assert.equal(root.query((element) => element.textContent === "Copy invite link"), null);
    state.invitationUrl = "https://play.example/?code=ZING";
    state.isInvitationDialogOpen = true;
    renderApp(root, state, actions, {}, {});
    const invitationDialog = root.query((element) => element.className.includes("invitation-dialog"));
    assert.equal(invitationDialog.getAttribute("aria-labelledby"), "invitation-dialog-title");
    assert.equal(invitationDialog.getAttribute("open"), "");
    assert.match(invitationDialog.text, /https:\/\/play\.example\/\?code=ZING/u);
    assert.equal(invitationDialog.query((element) => element.textContent === "Copy link"), null);
    const inlineCopyButton = invitationDialog.query((element) => element.getAttribute("aria-label") === "Copy invitation link");
    assert.ok(inlineCopyButton);
    assert.equal(inlineCopyButton.className.includes("invitation-copy-button"), true);
    assert.equal(inlineCopyButton.getAttribute("data-invitation-focus"), "copy");
    assert.ok(invitationDialog.query((element) => element.className.includes("invitation-url-row")));
    inlineCopyButton.dispatch("click");
    assert.ok(calls.some(([name]) => name === "onCopyInvitationLink"));
    assert.ok(invitationDialog.query((element) => element.textContent === "Share invite"));
    assert.ok(invitationDialog.query((element) => element.textContent === "Show QR code"));
    invitationDialog.dispatch("cancel", { preventDefault() {} });
    assert.ok(calls.some(([name]) => name === "onCloseInvitationDialog"));
    state.invitationQrDataUrl = "data:image/png;base64,encoded";
    state.isInvitationQrVisible = true;
    renderApp(root, state, actions, {}, {});
    const qrImage = root.query((element) => element.tagName === "img");
    assert.equal(qrImage.src, "data:image/png;base64,encoded");
    assert.equal(qrImage.alt, "QR code for this room invitation link");
    state.isInvitationDialogOpen = false;
    renderApp(root, state, actions, {}, {});
    state.invitationFeedback = "Room code copied.";
    state.roomCodeCopied = true;
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("invitation-toast")), null);
    assert.equal(
      root.query((element) => element.className.includes("room-code-chip")).children[1].children[1].children[0].attributes.d,
      "m5 12 4 4L19 6",
    );
    state.invitationFeedback = null;
    state.roomCodeCopied = false;
    renderApp(root, state, actions, {}, {});
    const guestKick = root.query((element) => element.getAttribute("aria-label") === "Remove Guest from room");
    assert.equal(guestKick, null);
    const guestCard = root.query((element) => element.className.includes("player-card") && element.dataset.playerId === "guest");
    assert.ok(guestCard);
    assert.equal(guestCard.tagName, "button");
    assert.equal(guestCard.getAttribute("aria-haspopup"), "dialog");
    assert.match(guestCard.text, /Guest/u);
    assert.match(guestCard.text, /Not ready/u);
    assert.match(guestCard.text, /GU/u);
    guestCard.dispatch("click");
    assert.ok(calls.some(([name]) => name === "onCopyRoomCode"));
    assert.ok(calls.some(([name]) => name === "onOpenInvitationDialog"));
    assert.ok(calls.some(([name, playerId]) => name === "onOpenPlayerCard" && playerId === "guest"));

    state.selectedPlayerId = "guest";
    renderApp(root, state, actions, {}, {});
    const playerDialog = root.query((element) => element.className.includes("player-detail-dialog"));
    assert.equal(playerDialog.getAttribute("aria-labelledby"), "player-detail-title");
    assert.equal(playerDialog.getAttribute("aria-modal"), "false");
    assert.equal(globalThis.document.activeElement.className, "player-detail-close");
    const makeHostButton = playerDialog.query((element) => element.getAttribute("aria-label") === "Make Guest host");
    assert.ok(makeHostButton);
    assert.equal(makeHostButton.query((element) => element.tagName === "svg").children[0].getAttribute("d"), "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Zm2 15h16");
    assert.ok(playerDialog.query((element) => element.textContent === "Remove from room"));
    playerDialog.dispatch("keydown", { key: "Escape" });
    assert.ok(calls.some(([name]) => name === "onClosePlayerCard"));

    state.selectedPlayerId = "host";
    renderApp(root, state, actions, {}, {});
    const ownCard = root.query((element) => element.className.includes("player-detail-dialog"));
    assert.equal(globalThis.document.activeElement.className, "player-detail-close");
    assert.match(ownCard.text, /Host/u);
    assert.ok(ownCard.query((element) => element.textContent === "Host"));
    assert.equal(ownCard.query((element) => element.textContent === "Ready"), null);
    assert.equal(ownCard.query((element) => element.textContent === "Not ready"), null);
    assert.equal(ownCard.query((element) => element.textContent === "Make host"), null);
    assert.equal(ownCard.query((element) => element.textContent === "Remove from room"), null);

    state.selectedPlayerId = null;
    state.pendingHostTransferId = "guest";
    renderApp(root, state, actions, {}, {});
    const transferConfirmation = root.query((element) => element.className.includes("kick-confirmation"));
    assert.equal(transferConfirmation.query((element) => element.tagName === "h2").textContent, "Make Guest host?");
    assert.match(transferConfirmation.text, /gain control of this lobby/u);
    assert.ok(transferConfirmation.query((element) => element.textContent === "Yes"));
    assert.equal(transferConfirmation.query((element) => element.className.includes("destructive-button")), null);
    transferConfirmation.query((element) => element.textContent === "Yes").dispatch("click");
    assert.ok(calls.some(([name]) => name === "onConfirmHostTransfer"));
    state.lobby.players.find(({ id }) => id === "guest").isHost = true;
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("kick-confirmation")), null);
    state.lobby.players.find(({ id }) => id === "guest").isHost = false;

    state.pendingHostTransferId = null;
    state.pendingKickPlayerId = "guest";
    renderApp(root, state, actions, {}, {});
    const removeConfirmation = root.query((element) => element.className.includes("kick-confirmation"));
    assert.equal(removeConfirmation.query((element) => element.tagName === "h2").textContent, "Kick Guest?");
    assert.match(removeConfirmation.text, /can rejoin with the room code/u);
    assert.ok(removeConfirmation.query((element) => element.textContent === "Kick!"));
    removeConfirmation.query((element) => element.textContent === "Cancel").dispatch("click");
    removeConfirmation.dispatch("keydown", { key: "Escape" });
    removeConfirmation.query((element) => element.textContent === "Kick!").dispatch("click");
    assert.equal(calls.some(([name]) => name === "onCancelKickPlayer"), true);
    assert.equal(calls.some(([name]) => name === "onConfirmKickPlayer"), true);

    state.localPlayerId = "guest";
    state.pendingKickPlayerId = null;
    state.selectedPlayerId = "host";
    renderApp(root, state, actions, {}, {});
    const guestViewCard = root.query((element) => element.className.includes("player-detail-dialog"));
    assert.ok(guestViewCard);
    assert.equal(guestViewCard.query((element) => element.textContent === "Make host"), null);
    assert.equal(guestViewCard.query((element) => element.textContent === "Remove from room"), null);
    state.selectedPlayerId = null;
    state.kickFeedback = "Guest is now the host.";
    renderApp(root, state, actions, {}, {});
    const notification = root.query((element) => element.className.includes("player-action-toast"));
    assert.equal(notification.text, "Guest is now the host.");
    assert.equal(notification.getAttribute("role"), "status");
    assert.equal(notification.getAttribute("aria-live"), "polite");
    assert.ok(notification.query((element) => element.className.includes("icon-check")));
  });
});

test("game selection is registry-driven and selecting a card does not create a room", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.currentView = "game-selection";
    state.availableGames = [
      { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
      { id: "fact-or-cap-anime", displayName: "Fact or Cap Anime", description: "Anime facts.", minPlayers: 2, maxPlayers: 8 },
      { id: "future-game", displayName: "Future Game", description: "A registered future game.", minPlayers: 4, maxPlayers: 8 },
    ];
    const calls = { selected: [], created: [] };
    const actions = {
      onChooseGame(gameId) { state.pendingGameId = gameId; calls.selected.push(gameId); },
      onChooseRoomVisibility(visibility) { state.pendingRoomVisibility = visibility; calls.visibility = visibility; },
      onConfirmCreateRoom(gameId) { calls.created.push(gameId); },
      onBackToHome() {},
    };
    const root = new FakeElement("root");
    const render = () => renderApp(root, state, actions, {}, {});
    render();

    const cards = root.query((element) => element.className.includes("game-card-grid"));
    assert.equal(cards.children.length, 3);
    assert.deepEqual(cards.children.map((card) => card.dataset.gameId), [
      "fact-or-cap", "fact-or-cap-anime", "future-game",
    ]);
    assert.match(root.text, /Future Game/u);
    assert.match(root.text, /4–8 players/u);
    const create = root.query((element) => element.className.includes("create-selected-game"));
    assert.equal(create.disabled, true);
    assert.deepEqual(cards.children.map((card) => card.children[0].className), [
      "game-card-art game-art-fact-or-cap",
      "game-card-art game-art-fact-or-cap-anime",
      "game-card-art game-art-generic",
    ]);

    const animePlay = root.query((element) => element.tagName === "button" && element.textContent === "Select game" && element.parentElement.parentElement.dataset.gameId === "fact-or-cap-anime");
    animePlay.dispatch("click");
    assert.deepEqual(calls.selected, ["fact-or-cap-anime"]);
    assert.deepEqual(calls.created, []);
    state.pendingGameId = "fact-or-cap-anime";
    render();
    assert.equal(root.query((element) => element.className.includes("create-selected-game")).disabled, false);
    const privateVisibility = root.query((element) => element.id === "create-room-visibility-private");
    const publicVisibility = root.query((element) => element.id === "create-room-visibility-public");
    assert.equal(privateVisibility.checked, true);
    assert.equal(publicVisibility.checked, false);
    const publicVisibilityTitle = publicVisibility.parentElement.query((element) => element.className.includes("visibility-option-title"));
    assert.ok(publicVisibilityTitle);
    const publicIcon = publicVisibilityTitle.query((element) => element.className.includes("icon-globe"));
    assert.ok(publicIcon);
    assert.ok(publicIcon.classList.contains("room-visibility-icon-public"));
    assert.equal(publicIcon.getAttribute("aria-hidden"), "true");
    const privateVisibilityTitle = privateVisibility.parentElement.query((element) => element.className.includes("visibility-option-title"));
    const privateIcon = privateVisibilityTitle.query((element) => element.className.includes("icon-lock"));
    assert.ok(privateIcon);
    assert.ok(privateIcon.classList.contains("room-visibility-icon-private"));
    assert.equal(privateIcon.getAttribute("aria-hidden"), "true");
    privateVisibility.checked = false;
    publicVisibility.checked = true;
    publicVisibility.dispatch("change");
    assert.equal(calls.visibility, "public");
    render();
    assert.ok(root.query((element) => element.className.includes("icon-globe")).classList.contains("room-visibility-icon-public"));
    assert.ok(root.query((element) => element.className.includes("icon-lock")).classList.contains("room-visibility-icon-private"));
    root.query((element) => element.className.includes("create-selected-game")).dispatch("click");
    assert.deepEqual(calls.created, ["fact-or-cap-anime"]);
  });
});

test("lobby game card shows authoritative metadata and only hosts can open game selection in both themes", () => {
  withFakeDocument(() => {
    for (const theme of ["dark", "light"]) {
      const state = createInitialAppState();
      state.theme = theme;
      state.currentView = "lobby";
      state.localPlayerId = "host";
      state.lobby = {
        roomCode: "ZING", revision: 2, playerCount: 2, readinessStatus: "waiting-for-ready",
        status: "lobby", visibility: "public", maxPlayers: 8, selectedGameId: "future-game", selectedRoundCount: 7,
        reminderSessionId: null,
        selectedGame: {
          id: "future-game",
          displayName: "Future Game",
          description: "A registered game with its own description.",
          minPlayers: 3,
          maxPlayers: 6,
        },
        availableGames: [
          { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
          { id: "future-game", displayName: "Future Game", description: "A registered game with its own description.", minPlayers: 3, maxPlayers: 6 },
        ],
        players: [
          { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
          { id: "guest", name: "Guest", isHost: false, isReady: true, isInGame: false },
        ],
      };
      const calls = [];
      const actions = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]) });
      const root = new FakeElement("root");
      renderApp(root, state, actions, {}, {});

      const card = root.query((element) => element.className.includes("selected-lobby-game"));
      assert.equal(card.dataset.gameId, "future-game");
      assert.equal(card.children[0].className.includes("game-card-art"), true);
      assert.equal(card.children[0].className, "game-card-art game-art-generic");
      assert.match(card.text, /A registered game with its own description\./u);
      assert.match(card.text, /3–6 players/u);
      assert.ok(root.query((element) => element.className.includes("lobby-room-code-panel")));
      const choose = root.query((element) => element.tagName === "button" && element.textContent === "Switch game");
      assert.ok(choose);
      assert.ok(choose.query((element) => element.className.includes("icon-switch")));
      choose.dispatch("click");
      assert.deepEqual(calls, [["onChooseAnotherGame"]]);

      state.localPlayerId = "guest";
      renderApp(root, state, actions, {}, {});
      assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Switch game"), null);
      assert.equal(root.query((element) => element.textContent === "Select game"), null);
    }
  });
});

test("lobby game selection uses registered cards and returns through the existing selection action", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.currentView = "game-selection";
    state.localPlayerId = "host";
    state.roomCode = "ZING";
    state.lobby = {
      roomCode: "ZING", revision: 4, playerCount: 2, readinessStatus: "waiting-for-ready",
      status: "lobby", visibility: "public", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 7,
      reminderSessionId: null,
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
      availableGames: [
        { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
        { id: "future-game", displayName: "Future Game", description: "A registered future game.", minPlayers: 3, maxPlayers: 6 },
      ],
      players: [
        { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
        { id: "guest", name: "Guest", isHost: false, isReady: true, isInGame: false },
      ],
    };
    state.availableGames = state.lobby.availableGames;
    const calls = [];
    const actions = new Proxy({}, {
      get: (_target, name) => (...args) => calls.push([name, ...args]),
    });
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});

    assert.match(root.text, /Choose another game/u);
    assert.equal(root.query((element) => element.id === "create-room-visibility-public"), null);
    assert.equal(root.query((element) => element.className.includes("create-selected-game")), null);
    const cards = root.query((element) => element.className.includes("game-card-grid"));
    assert.deepEqual(cards.children.map((card) => card.dataset.gameId), ["fact-or-cap", "future-game"]);
    const futureGameButton = root.query((element) =>
      element.tagName === "button" &&
      element.textContent === "Select game" &&
      element.parentElement.parentElement.dataset.gameId === "future-game");
    assert.equal(futureGameButton.disabled, false);
    futureGameButton.dispatch("click");
    assert.deepEqual(calls, [["onChooseGame", "future-game"]]);

    state.localPlayerId = "guest";
    renderApp(root, state, actions, {}, {});
    const guestChoice = root.query((element) => element.textContent === "Select game");
    assert.ok(guestChoice.disabled);
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Choose another game"), null);
  });
});

test("room visibility uses accessible radio choices and remains read-only for guests", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.localPlayerId = "host";
    state.lobby = {
      roomCode: "ZING", revision: 2, playerCount: 2, readinessStatus: "waiting-for-ready",
      status: "lobby", visibility: "private", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 5,
      reminderSessionId: "finished-session",
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
      availableGames: [],
      players: [
        { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
        { id: "guest", name: "Guest", isHost: false, isReady: false, isInGame: false },
      ],
    };
    const changes = [];
    const actions = new Proxy({}, {
      get: (_target, name) => (...args) => changes.push([name, ...args]),
    });

    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});

    const visibilityMenu = root.query((element) => element.className.includes("room-visibility-menu"));
    const visibilityPill = visibilityMenu.query((element) => element.tagName === "summary");
    assert.equal(visibilityPill.getAttribute("aria-label"), "Room visibility: Private");
    assert.equal(visibilityPill.getAttribute("aria-haspopup"), "menu");
    assert.equal(visibilityPill.getAttribute("aria-expanded"), "false");
    assert.ok(visibilityPill.query((element) => element.className.includes("room-visibility-icon-private")));
    assert.equal(visibilityPill.query((element) => element.className.includes("room-visibility-icon-public")), null);
    const menu = visibilityMenu.query((element) => element.getAttribute("role") === "menu");
    const makePublic = menu.query((element) => element.getAttribute("role") === "menuitem");
    assert.equal(makePublic.textContent, "Make public");
    visibilityMenu.open = true;
    visibilityMenu.dispatch("toggle");
    assert.equal(visibilityPill.getAttribute("aria-expanded"), "true");
    makePublic.dispatch("click");
    assert.deepEqual(changes, [["onSetRoomVisibility", "public"]]);
    assert.equal(root.query((element) => element.getAttribute("aria-label") === "5 rounds").disabled, false);
    assert.ok(root.query((element) => element.className.includes("lobby-content-grid")));
    const headingBar = root.query((element) => element.className.includes("lobby-heading-bar"));
    assert.equal(headingBar.children[0].textContent, "Lobby");
    const rounds = root.query((element) => element.className.includes("round-selector"));
    assert.equal(rounds.parentElement.className, "lobby-settings-row");
    assert.equal(rounds.children[0].textContent, "Rounds");
    assert.equal(
      rounds.query((element) => element.className.includes("round-options")).children.map((button) => button.textContent).join(", "),
      "5, 7, 10",
    );
    assert.equal(root.query((element) => element.className.includes("lobby-settings-panel")), null);
    const hostActions = root.query((element) => element.className.includes("host-lobby-actions"));
    assert.deepEqual(hostActions.children.map((button) => button.text), [
      "Start game", "Leave room", "Ask everyone to return to lobby",
    ]);
    assert.equal(hostActions.parentElement.className.includes("lobby-content-grid"), true);
    assert.equal(root.query((element) => element.className.includes("visibility-field")), null);

    state.localPlayerId = "guest";
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("room-visibility-menu")), null);
    assert.equal(root.query((element) => element.getAttribute("aria-label") === "Room visibility: Private").tagName, "span");
    assert.doesNotMatch(root.text, /Room visibility/u);
    assert.equal(root.query((element) => element.getAttribute("aria-label") === "5 rounds"), null);
    const readonlyRounds = root.query((element) => element.className.includes("readonly-setting-value"));
    assert.ok(readonlyRounds);
    assert.equal(readonlyRounds.textContent, "Number of rounds: 5");
    assert.equal(
      root.query((element) => element.className.includes("round-selector"))
        .children.some((element) => element.className.includes("field-label")),
      false,
    );
    assert.match(root.text, /Number of rounds: 5/u);
    assert.doesNotMatch(root.text, /Rounds\s+5 rounds/u);
    const guestActions = root.query((element) => element.className.includes("lobby-actions"));
    assert.deepEqual(guestActions.children.map((button) => button.textContent), ["Ready", "Leave room"]);
    assert.equal(root.queryAll((element) => element.tagName === "button" && element.textContent === "Ready").length, 1);

    state.lobby.visibility = "public";
    state.localPlayerId = "host";
    renderApp(root, state, actions, {}, {});
    const publicMenu = root.query((element) => element.className.includes("room-visibility-menu"));
    assert.equal(publicMenu.query((element) => element.tagName === "summary").getAttribute("aria-label"), "Room visibility: Public");
    assert.ok(publicMenu.query((element) => element.className.includes("room-visibility-icon-public")));
    const makePrivate = publicMenu.query((element) => element.getAttribute("role") === "menuitem");
    assert.equal(makePrivate.textContent, "Make private");
    makePrivate.dispatch("click");
    assert.deepEqual(changes.at(-1), ["onSetRoomVisibility", "private"]);

    state.isBusy = true;
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.getAttribute("role") === "menuitem").disabled, true);
  });
});

test("player name validation matches the server length, trim, and control-character rules", () => {
  assert.equal(validatePlayerName("  Alex  "), null);
  assert.equal(validatePlayerName("a".repeat(20)), null);
  assert.match(validatePlayerName("   "), /1 and 20/u);
  assert.match(validatePlayerName("a".repeat(21)), /1 and 20/u);
  assert.match(validatePlayerName("Alex\n"), /1 and 20/u);
});

test("game selection provides in-flow name entry and keeps selected creation settings", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "game-selection";
    state.connectionStatus = "connected";
    state.pendingGameId = "fact-or-cap";
    state.playerName = "Alex";
    state.pendingRoomVisibility = "public";
    state.availableGames = [
      { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
    ];
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});

    const name = root.query((element) => element.id === "selection-player-name");
    assert.equal(name.value, "Alex");
    assert.equal(name.placeholder, "Your name");
    assert.equal(name.required, true);
    assert.equal(name.maxLength, -1);
    assert.equal(root.query((element) => element.id === "create-room-visibility-public").checked, true);
    assert.equal(root.query((element) => element.textContent === "Create room").disabled, false);
    const visibilityField = root.query((element) => element.className.includes("create-visibility-field"));
    assert.equal(visibilityField.children[0].tagName, "legend");
    assert.equal(visibilityField.children[0].textContent, "Room visibility");
    const visibilityOptions = visibilityField.query((element) => element.className.includes("visibility-options"));
    assert.equal(visibilityOptions.children.length, 2);
    assert.ok(visibilityOptions.children.every((option) => option.className.includes("visibility-option")));
    assert.equal(visibilityOptions.children[0].query((child) => child.tagName === "input").value, "public");
    assert.equal(visibilityOptions.children[1].query((child) => child.tagName === "input").value, "private");
    assert.ok(visibilityOptions.children[0].className.includes("selected"));
    assert.equal(visibilityOptions.children[1].className.includes("selected"), false);

    state.nameEntryError = "Enter a player name between 1 and 20 characters.";
    name.focus();
    assert.doesNotThrow(() => renderApp(root, state, createActions(), {}, {}));
    assert.equal(globalThis.document.activeElement, name);
    assert.equal(root.query((element) => element.id === "selection-player-name").getAttribute("aria-invalid"), "true");
    assert.match(root.text, /Enter a player name between 1 and 20 characters/u);
  });
});

test("public-room name entry retains the selected room until the user continues", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "public-rooms";
    state.connectionStatus = "connected";
    state.pendingPublicRoomId = "public-room-1";
    state.publicRooms = [{
      roomId: "public-room-1",
      hostName: "Alex",
      gameId: "fact-or-cap",
      gameName: "Fact or Cap",
      gameDescription: "Bluff with facts.",
      playerCount: 2,
      maxPlayers: 8,
      status: "lobby",
    }];
    const calls = [];
    const actions = new Proxy({}, {
      get: (_target, name) => (...args) => calls.push([name, ...args]),
    });
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});

    const roomCard = root.query((element) => element.dataset.roomId === "public-room-1");
    assert.equal(roomCard.query((element) => element.textContent === "Alex's room").tagName, "h2");
    assert.equal(roomCard.query((element) => element.textContent === "Join").getAttribute("aria-expanded"), "true");
    assert.equal(root.query((element) => element.id === "public-room-player-name").required, true);
    root.query((element) => element.textContent === "Join room").dispatch("click");
    root.query((element) => element.textContent === "Cancel").dispatch("click");
    assert.deepEqual(calls.map(([action]) => action), [
      "onContinuePublicRoomJoin",
      "onCancelPublicRoomJoin",
    ]);
    assert.equal(state.pendingPublicRoomId, "public-room-1");
  });
});

test("lobby lists the authoritative host first with a crown and no host readiness badge", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.localPlayerId = "host";
    state.lobby = {
      roomCode: "ZING", revision: 2, playerCount: 3, readinessStatus: "waiting-for-ready",
      status: "lobby", visibility: "public", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 7,
      reminderSessionId: null,
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
      availableGames: [],
      players: [
        { id: "guest", name: "Guest Player", isHost: false, isReady: true, isInGame: false },
        { id: "host", name: "Host Player", isHost: true, isReady: false, isInGame: false },
        { id: "other", name: "Other Player", isHost: false, isReady: false, isInGame: false },
      ],
    };
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const playerList = root.query((element) => element.className.includes("player-list"));
    const getPlayerId = (item) => item.children[0].dataset.playerId;
    assert.deepEqual(playerList.children.map(getPlayerId), ["host", "guest", "other"]);
    const hostRow = playerList.children[0].children[0];
    const guestRow = playerList.children[1].children[0];
    assert.ok(hostRow.query((element) => element.className.includes("host-crown-icon")));
    assert.equal(guestRow.query((element) => element.className.includes("host-crown-icon")), null);
    assert.equal(hostRow.query((element) => element.className.includes("ready-badge")), null);
    assert.equal(hostRow.query((element) => element.className.includes("not-ready-badge")), null);
    assert.ok(guestRow.query((element) => element.className.includes("ready-badge")));

    state.localPlayerId = "host";
    state.lobby.players[0].isHost = true;
    state.lobby.players[1].isHost = false;
    renderApp(root, state, createActions(), {}, {});
    const transferredList = root.query((element) => element.className.includes("player-list"));
    assert.deepEqual(transferredList.children.map(getPlayerId), ["guest", "host", "other"]);
    assert.ok(transferredList.children[0].query((element) => element.className.includes("host-crown-icon")));
    assert.equal(transferredList.children[1].query((element) => element.className.includes("host-crown-icon")), null);
    assert.equal(root.query((element) => element.id === "room-visibility-public"), null);
    assert.equal(root.query((element) => element.getAttribute("aria-label") === "Room visibility: Public").tagName, "span");
    assert.doesNotMatch(root.text, /Room visibility/u);
  });
});

test("lobby controls expose compact invitation and visibility hooks and hide unsupported rounds", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.localPlayerId = "host";
    state.roomCodeCopied = true;
    state.lobby = {
      roomCode: "ZING", revision: 2, playerCount: 2, readinessStatus: "waiting-for-ready",
      status: "lobby", visibility: "private", maxPlayers: 8, selectedGameId: "future-game", selectedRoundCount: 5,
      reminderSessionId: null,
      selectedGame: {
        id: "future-game", displayName: "Future Game", description: "A future game.",
        minPlayers: 2, maxPlayers: 8, supportsRoundSelection: false,
      },
      availableGames: [],
      players: [
        { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
        { id: "guest", name: "Guest", isHost: false, isReady: true, isInGame: false },
      ],
    };
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const roomCode = root.query((element) => element.className.includes("room-code-chip"));
    const invite = root.query((element) => element.className.includes("invite-friends-button"));
    assert.match(root.text, /Room CodeZING/u);
    assert.equal(roomCode.className.includes("room-code-chip"), true);
    assert.equal(invite.children[1].className, "invite-label-long");
    assert.equal(invite.children[2].className, "invite-label-short");
    assert.match(roomCode.getAttribute("aria-label"), /copied/u);
    assert.ok(invite.query((element) => element.tagName === "svg"));
    assert.equal(root.query((element) => element.className.includes("round-selector")), null);
    assert.equal(root.query((element) => element.className.includes("lobby-settings-panel")), null);
    assert.equal(root.query((element) => element.className.includes("lobby-heading-bar")).children[1].className.includes("room-visibility-menu"), true);
    assert.doesNotMatch(root.text, /Discoverable while seats are open|Join with a room code/u);
    const changeGame = root.query((element) => element.textContent === "Switch game");
    assert.ok(changeGame.query((element) => element.className.includes("icon-switch")));
  });
});

test("public-room host names are rendered as text and long names remain available", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "public-rooms";
    state.publicRooms = [{
      roomId: "opaque-long-name-room",
      hostName: "<abcdefghijklmnopqr>",
      gameId: "fact-or-cap",
      gameName: "Fact or Cap",
      gameDescription: "Bluff with facts.",
      playerCount: 1,
      maxPlayers: 8,
      status: "lobby",
    }];
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const title = root.query((element) => element.className.includes("public-room-room-name"));
    assert.equal(title.textContent, "<abcdefghijklmnopqr>'s room");
    assert.equal(root.query((element) => element.tagName === "img"), null);
  });
});

test("landing action label leads to game selection while joining and public-room browsing remain available", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.availableGames = [
      { id: "fact-or-cap", displayName: "Fact or Cap", description: "Bluff with facts.", minPlayers: 2, maxPlayers: 8 },
    ];
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    assert.ok(root.query((element) => element.tagName === "button" && element.textContent === "Choose a game"));
    assert.ok(root.query((element) => element.id === "room-code"));
    assert.ok(root.query((element) => element.textContent === "Browse public rooms"));
  });
});

test("public room browser renders compact cards, accessible refresh, and a concise empty state", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "public-rooms";
    state.connectionStatus = "connected";
    state.isLoadingPublicRooms = true;
    const calls = [];
    const actions = {
      onRefreshPublicRooms() { calls.push("refresh"); },
      onBackFromPublicRooms() { calls.push("back"); },
      onJoinPublicRoom(roomId) { calls.push(roomId); },
    };
    const root = new FakeElement("root");
    const render = () => renderApp(root, state, actions, {}, {});
    render();
    assert.match(root.text, /Finding open rooms/u);
    const pendingRefresh = root.query((element) => element.className.includes("public-room-refresh"));
    assert.equal(pendingRefresh.disabled, true);
    assert.equal(pendingRefresh.getAttribute("aria-busy"), "true");
    assert.ok(pendingRefresh.query((element) => element.className.includes("public-room-refresh-icon")));

    state.isLoadingPublicRooms = false;
    render();
    assert.ok(root.query((element) => element.tagName === "h1" && element.textContent === "Find a table"));
    assert.match(root.text, /No open rooms yet/u);
    assert.equal(root.text.includes("Choose a game"), false);
    const refresh = root.query((element) => element.className.includes("public-room-refresh"));
    assert.equal(refresh.attributes["aria-label"], "Refresh public rooms");
    assert.equal(refresh.title, "Refresh public rooms");
    assert.equal(refresh.children[0].tagName, "svg");
    assert.equal(refresh.children[0].attributes["aria-hidden"], "true");
    const refreshPath = refresh.children[0].query((element) => element.tagName === "path");
    assert.match(refreshPath.attributes.d, /M21 2v6h-6/u);
    assert.match(refreshPath.attributes.d, /a9 9 0 1 1/u);
    assert.doesNotMatch(refreshPath.attributes.d, /M4 17/u);

    state.publicRooms = [{
      roomId: "opaque-public-id",
      hostName: "Alex",
      gameId: "fact-or-cap",
      gameName: "Fact or Cap",
      gameDescription: "Bluff with facts.",
      playerCount: 3,
      maxPlayers: 8,
      status: "lobby",
    }, {
      roomId: "opaque-anime-room",
      hostName: "James",
      gameId: "fact-or-cap-anime",
      gameName: "Fact or Cap (Anime)",
      gameDescription: "Anime facts.",
      playerCount: 1,
      maxPlayers: 8,
      status: "lobby",
    }, {
      roomId: "opaque-bruh-room",
      hostName: "Riley",
      gameId: "bruh-wtf",
      gameName: "Bruh wtf?",
      gameDescription: "Answer and vote.",
      playerCount: 2,
      maxPlayers: 8,
      status: "lobby",
    }, {
      roomId: "opaque-future-room",
      hostName: "Taylor",
      gameId: "future-game",
      gameName: "Future game",
      gameDescription: "More surprises.",
      playerCount: 3,
      maxPlayers: 8,
      status: "lobby",
    }];
    render();
    assert.match(root.text, /3\/8 players/u);
    assert.equal(root.text.includes("ABCD"), false);
    assert.equal(root.text.includes("Bluff with facts."), false);
    const publicCards = root.query((element) => element.className.includes("public-room-grid")).children;
    assert.ok(publicCards[0].query((element) => element.textContent === "Alex's room"));
    assert.ok(publicCards[0].query((element) => element.textContent === "Fact or Cap"));
    assert.ok(publicCards[0].query((element) => element.textContent === "3/8 players"));
    assert.ok(publicCards[0].query((element) => element.textContent === "Join"));
    assert.ok(publicCards[1].query((element) => element.textContent === "James' room"));
    const occupancy = publicCards[0].query((element) => element.getAttribute("role") === "progressbar");
    assert.equal(occupancy.getAttribute("aria-valuemin"), "0");
    assert.equal(occupancy.getAttribute("aria-valuemax"), "8");
    assert.equal(occupancy.getAttribute("aria-valuenow"), "3");
    assert.equal(occupancy.getAttribute("aria-valuetext"), "3 of 8 players");
    assert.equal(publicCards[0].query((element) => element.className.includes("public-room-occupancy-fill")).style.width, "37.5%");
    assert.deepEqual(publicCards.map((card) => card.children[0].className), [
      "game-card-art game-art-fact-or-cap",
      "game-card-art game-art-fact-or-cap-anime",
      "game-card-art game-art-bruh-wtf",
      "game-card-art game-art-generic",
    ]);
    assert.deepEqual(publicCards.map((card) => card.dataset.gameId), [
      "fact-or-cap", "fact-or-cap-anime", "bruh-wtf", "future-game",
    ]);
    assert.equal(root.text.includes("Anime facts."), false);
    const originalArtByRoom = new Map(publicCards.map((card) => [card.dataset.roomId, card.children[0].className]));
    state.publicRooms.reverse();
    render();
    const reorderedCards = root.query((element) => element.className.includes("public-room-grid")).children;
    assert.deepEqual(
      new Map(reorderedCards.map((card) => [card.dataset.roomId, card.children[0].className])),
      originalArtByRoom,
    );
    root.query((element) => element.dataset.roomId === "opaque-public-id")
      .query((element) => element.tagName === "button" && element.textContent === "Join")
      .dispatch("click");
    refresh.dispatch("click");
    root.query((element) => element.textContent === "Back").dispatch("click");
    assert.deepEqual(calls, ["opaque-public-id", "refresh", "back"]);

    state.publicRoomsError = "That room is full.";
    state.isLoadingPublicRooms = true;
    render();
    assert.equal(root.query((element) => element.className.includes("public-room-refresh")).disabled, true);
    state.isLoadingPublicRooms = false;
    render();
    assert.equal(root.query((element) => element.className.includes("public-room-refresh")).disabled, false);
    assert.equal(root.query((element) => element.attributes.role === "alert").textContent, "That room is full.");
    state.publicRooms = [];
    render();
    assert.equal(root.query((element) => element.className.includes("public-room-empty")), null);
  });
});

test("public-room selection is cleared when its room disappears or fills", () => {
  const state = createInitialAppState();
  const room = {
    roomId: "public-room-1",
    hostName: "Alex",
    gameId: "fact-or-cap",
    gameName: "Fact or Cap",
    gameDescription: "Bluff with facts.",
    playerCount: 2,
    maxPlayers: 8,
    status: "lobby",
  };
  state.pendingPublicRoomId = room.roomId;
  state.nameEntryError = "Enter a player name between 1 and 20 characters.";
  state.publicRooms = [room];
  assert.equal(reconcilePublicRooms(state, [{ ...room, playerCount: 3 }]), false);
  assert.equal(state.pendingPublicRoomId, room.roomId);
  assert.equal(state.nameEntryError !== null, true);

  assert.equal(reconcilePublicRooms(state, [{ ...room, playerCount: 8 }]), true);
  assert.equal(state.pendingPublicRoomId, null);
  assert.equal(state.nameEntryError, null);
  assert.match(state.publicRoomsError, /no longer available/u);
  assert.equal(state.publicRooms[0].playerCount, 8);

  state.pendingPublicRoomId = room.roomId;
  state.nameEntryError = "Enter your name.";
  assert.equal(reconcilePublicRooms(state, []), true);
  assert.equal(state.pendingPublicRoomId, null);
  assert.equal(state.nameEntryError, null);
  assert.deepEqual(state.publicRooms, []);
  withFakeDocument(() => {
    state.currentView = "public-rooms";
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    assert.equal(root.query((element) => element.id === "public-room-player-name"), null);
    assert.match(root.text, /That room is no longer available/u);
  });
});

test("full public rooms remain visible but cannot be selected to join", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "public-rooms";
    state.publicRooms = [{
      roomId: "full-room",
      hostName: "Alex",
      gameId: "fact-or-cap",
      gameName: "Fact or Cap",
      gameDescription: "Bluff with facts.",
      playerCount: 8,
      maxPlayers: 8,
      status: "lobby",
    }];
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const fullButton = root.query((element) => element.className.includes("public-room-join"));
    assert.equal(fullButton.textContent, "Full");
    assert.equal(fullButton.disabled, true);
    assert.equal(fullButton.getAttribute("aria-expanded"), "false");
  });
});

test("room-code copy feedback uses the copied control state without a duplicate toast", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.localPlayerId = "host";
    state.roomCodeCopied = true;
    state.invitationFeedback = "Room code copied.";
    state.lobby = {
      roomCode: "ZING", revision: 1, playerCount: 1, readinessStatus: "insufficient-players",
      status: "lobby", visibility: "private", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 5,
      reminderSessionId: null,
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Game", minPlayers: 2, maxPlayers: 8 },
      availableGames: [],
      players: [{ id: "host", name: "Host", isHost: true, isReady: false, isInGame: false }],
    };
    const root = new FakeElement("root");
    renderApp(root, state, createActions(), {}, {});
    const roomCode = root.query((element) => element.className.includes("room-code-chip"));
    assert.equal(roomCode.attributes["aria-label"], "Room code ZING copied");
    assert.equal(roomCode.children[1].children[1].children[0].attributes.d, "m5 12 4 4L19 6");
    assert.equal(root.query((element) => element.className.includes("invitation-toast")), null);
  });
});

test("theme preference defaults safely, persists, and the header exposes an accessible toggle", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  assert.equal(readThemePreference(storage), "dark");
  values.set(THEME_STORAGE_KEY, "invalid");
  assert.equal(readThemePreference(storage), "dark");
  persistThemePreference("light", storage);
  assert.equal(readThemePreference(storage), "light");
  assert.doesNotThrow(() => readThemePreference({ getItem() { throw new Error("storage blocked"); }, setItem() {} }));

  withFakeDocument(() => {
    const state = createInitialAppState();
    state.theme = "dark";
    let toggles = 0;
    const actions = {
      onToggleTheme() {
        toggles += 1;
        state.theme = state.theme === "dark" ? "light" : "dark";
        persistThemePreference(state.theme, storage);
      },
    };
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    const button = root.query((element) => element.className.includes("theme-toggle"));
    assert.equal(button.attributes["aria-label"], "Switch to light theme");
    assert.equal(button.title, "Switch to light theme");
    assert.equal(button.attributes["aria-pressed"], "false");
    const darkIcons = button.query((element) => element.className.includes("theme-toggle-icons"));
    assert.equal(darkIcons.children.length, 2);
    assert.ok(darkIcons.query((element) => element.className.includes("theme-toggle-sun")));
    assert.ok(darkIcons.query((element) => element.className.includes("theme-toggle-moon")));
    button.dispatch("click");
    assert.equal(toggles, 1);
    renderApp(root, state, actions, {}, {});
    const lightThemeButton = root.query((element) => element.className.includes("theme-toggle"));
    assert.equal(lightThemeButton.attributes["aria-label"], "Switch to dark theme");
    assert.equal(lightThemeButton.title, "Switch to dark theme");
    assert.equal(lightThemeButton.attributes["aria-pressed"], "true");
    assert.equal(
      lightThemeButton.query((element) => element.className.includes("theme-toggle-moon")).getAttribute("aria-hidden"),
      "true",
    );
    assert.equal(readThemePreference(storage), "light");
  });
});

test("results viewers remain marked in-game and can accept or dismiss host return reminders", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.currentView = "lobby";
    state.connectionStatus = "connected";
    state.localPlayerId = "host";
    state.roomCode = "ABCD";
    state.lobby = {
      roomCode: "ABCD", revision: 3, playerCount: 1, readinessStatus: "insufficient-players",
      status: "lobby", visibility: "private", maxPlayers: 8, selectedGameId: "fact-or-cap", selectedRoundCount: 5,
      reminderSessionId: "finished-session",
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Game", minPlayers: 2, maxPlayers: 8 },
      availableGames: [],
      players: [
        { id: "host", name: "Host", isHost: true, isReady: false, isInGame: false },
        { id: "viewer", name: "Viewer", isHost: false, isReady: false, isInGame: true },
      ],
    };
    const calls = [];
    const actions = new Proxy({}, { get: (_target, name) => () => calls.push(name) });
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    assert.match(root.text, /1 player in lobby/u);
    assert.match(root.text, /1 player in lobby \(8 max\)/u);
    const visibilityMenu = root.query((element) => element.className.includes("room-visibility-menu"));
    assert.equal(visibilityMenu.query((element) => element.tagName === "summary").getAttribute("aria-label"), "Room visibility: Private");
    assert.doesNotMatch(root.text, /Join with a room code/u);
    assert.match(root.text, /Viewer.*In-game/u);
    const hostCard = root.query((element) => element.className.includes("player-card") && element.text.includes("Host"));
    assert.equal(hostCard.children[1].textContent, "Host");
    assert.equal(hostCard.children.some((element) => element.textContent === "Ready" || element.textContent === "Not ready"), false);
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Ready"), null);
    const reminder = root.query((element) => element.className.includes("reminder-button"));
    assert.ok(reminder);
    reminder.dispatch("click");
    assert.equal(calls.includes("onAskResultsViewersToReturn"), true);

    state.isBusy = true;
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("reminder-button")).disabled, true);
    state.isBusy = false;
    state.isSendingResultsReminder = true;
    renderApp(root, state, actions, {}, {});
    const sending = root.query((element) => element.className.includes("reminder-button"));
    assert.equal(sending.text, "Sending reminder…");
    assert.equal(sending.disabled, true);
    assert.equal(sending.attributes["aria-busy"], "true");
    state.isSendingResultsReminder = false;
    state.resultsReminderSentSessionId = "finished-session";
    renderApp(root, state, actions, {}, {});
    const sent = root.query((element) => element.className.includes("reminder-button"));
    assert.equal(sent.text, "Reminder sent");
    assert.equal(sent.disabled, false);
    assert.ok(sent.query((element) => element.className.includes("icon-check")));
    assert.equal(root.query((element) => element.className.includes("floating-notification")), null);
    sent.dispatch("click");
    assert.equal(calls.filter((name) => name === "onAskResultsViewersToReturn").length, 2);
    state.resultsReminderSentSessionId = null;
    renderApp(root, state, actions, {}, {});
    const reusableReminder = root.query((element) => element.className.includes("reminder-button"));
    assert.equal(reusableReminder.text, "Ask everyone to return to lobby");
    reusableReminder.dispatch("click");
    assert.equal(calls.filter((name) => name === "onAskResultsViewersToReturn").length, 3);

    state.lobby.playerCount = 2;
    state.lobby.readinessStatus = "ready";
    state.lobby.players[1].isInGame = false;
    state.lobby.players[1].isReady = true;
    renderApp(root, state, actions, {}, {});
    const start = root.query((element) => element.tagName === "button" && element.textContent === "Start game");
    assert.equal(start.disabled, false);
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Ready"), null);

    state.localPlayerId = "viewer";
    state.resultsReminderSentSessionId = null;
    state.lobby.players[1].isReady = false;
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.id === "room-visibility-private"), null);
    assert.equal(root.query((element) => element.getAttribute("aria-label") === "Room visibility: Private").tagName, "span");
    assert.doesNotMatch(root.text, /Room visibility/u);
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Ready").disabled, false);
    state.lobby.players[1].isInGame = true;
    state.lobby.playerCount = 1;
    state.lobby.readinessStatus = "insufficient-players";
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Ready").disabled, true);
    assert.equal(root.query((element) => element.className.includes("reminder-button")), null);

    state.currentView = "game";
    state.resultsReminderSessionId = "finished-session";
    renderApp(root, state, actions, {}, {});
    assert.match(root.text, /The host is waiting in the lobby\./u);
    assert.match(root.text, /Return to Lobby\?/u);
    const reminderDialog = root.query((element) => element.className.includes("results-reminder-dialog"));
    assert.equal(reminderDialog.tagName, "dialog");
    assert.equal(reminderDialog.getAttribute("aria-labelledby"), "results-reminder-title");
    assert.equal(reminderDialog.getAttribute("aria-describedby"), "results-reminder-description");
    assert.equal(reminderDialog.getAttribute("open"), "");
    assert.ok(reminderDialog.query((element) => element.className.includes("icon-door")));
    assert.equal(reminderDialog.query((element) => element.tagName === "h2").textContent, "Return to Lobby?");
    assert.equal(reminderDialog.query((element) => element.textContent === "Yes").textContent, "Yes");
    assert.ok(reminderDialog.query((element) => element.className.includes("results-reminder-actions")));
    reminderDialog.dispatch("keydown", { key: "Escape", preventDefault() {} });
    reminderDialog.dispatch("cancel", { preventDefault() {} });
    root.query((element) => element.textContent === "Wait").dispatch("click");
    root.query((element) => element.textContent === "Yes").dispatch("click");
    assert.equal(calls.includes("onDismissResultsReminder"), true);
    assert.equal(calls.includes("onAcceptResultsReminder"), true);

    state.isBusy = true;
    state.errorMessage = "The server did not respond.";
    renderApp(root, state, actions, {}, {});
    const pendingDialog = root.query((element) => element.className.includes("results-reminder-dialog"));
    assert.equal(pendingDialog.query((element) => element.textContent === "Wait").disabled, true);
    assert.equal(pendingDialog.query((element) => element.textContent === "Returning…").disabled, true);
    assert.equal(pendingDialog.query((element) => element.attributes.role === "alert").textContent, state.errorMessage);
    const dismissCallsBeforePendingEscape = calls.filter(([name]) => name === "onDismissResultsReminder").length;
    pendingDialog.dispatch("keydown", { key: "Escape", preventDefault() {} });
    pendingDialog.dispatch("cancel", { preventDefault() {} });
    assert.equal(
      calls.filter(([name]) => name === "onDismissResultsReminder").length,
      dismissCallsBeforePendingEscape,
    );
  });
});

test("duplicate-name feedback is shown by the name field and can be cleared for retry", () => {
  withFakeDocument(() => {
    const state = createInitialAppState();
    state.connectionStatus = "connected";
    state.playerName = "Alex";
    state.errorCode = "DUPLICATE_PLAYER_NAME";
    state.errorMessage = "That name is already used in this room. Choose another name.";
    const actions = {
      onPlayerNameChange(name) { state.playerName = name; state.errorMessage = null; state.errorCode = null; },
      onCreateRoom() {},
      onJoinRoom() {},
    };
    const root = new FakeElement("root");
    renderApp(root, state, actions, {}, {});
    const error = root.query((element) => element.className.includes("duplicate-name-error"));
    assert.equal(error.textContent, state.errorMessage);
    assert.equal(error.attributes.role, "alert");
    assert.equal(root.query((element) => element.tagName === "input" && element.id === "player-name").value, "Alex");

    const editedName = root.query((element) => element.id === "player-name");
    editedName.value = "Alex Two";
    editedName.dispatch("input");
    assert.equal(state.playerName, "Alex Two");
    assert.equal(state.errorCode, null);
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.className.includes("duplicate-name-error")), null);
  });
});
