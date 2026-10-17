import assert from "node:assert/strict";
import test from "node:test";
import { createInitialAppState, LANDING_TAGLINES } from "../src/appState.ts";
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
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = "none";
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
  setSelectionRange(start, end, direction = "none") {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
  dispatch(type) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {} }); }
  query(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.query(predicate);
      if (result) return result;
    }
    return null;
  }
  querySelector(selector) {
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

test("landing page selects a tagline once and keeps its form interactions usable", () => {
  withFakeDocument(() => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const state = createInitialAppState();
      state.connectionStatus = "connected";
      const selected = state.landingTagline;
      assert.ok(LANDING_TAGLINES.includes(selected));
      assert.equal(selected, LANDING_TAGLINES[Math.floor(LANDING_TAGLINES.length * 0.5)]);
      Math.random = () => 0;
      assert.equal(createInitialAppState().landingTagline, LANDING_TAGLINES[0]);
      Math.random = () => 0.5;

      const calls = { create: 0, join: [], names: [] };
      const actions = {
        onPlayerNameChange(name) { state.playerName = name; state.errorMessage = null; state.errorCode = null; calls.names.push(name); },
        onCreateRoom() { calls.create += 1; },
        onJoinRoom(code) { calls.join.push(code); },
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

      nameInput.value = "Alex";
      nameInput.dispatch("input");
      render();
      assert.equal(state.landingTagline, selected);
      assert.equal(root.query((element) => element.className.includes("landing-tagline")).textContent, selected);
      assert.equal(root.query((element) => element.id === "player-name").value, "Alex");
      root.query((element) => element.textContent === "Create room").dispatch("click");
      root.query((element) => element.id === "room-code").value = "ABCD";
      root.query((element) => element.textContent === "Join room").dispatch("click");
      assert.equal(calls.create, 1);
      assert.deepEqual(calls.join, ["ABCD"]);
      assert.deepEqual(calls.names, ["Alex"]);
    } finally {
      Math.random = originalRandom;
    }
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
      status: "lobby", selectedGameId: "fact-or-cap", selectedRoundCount: 5,
      reminderSessionId: "finished-session",
      selectedGame: { id: "fact-or-cap", displayName: "Fact or Cap", description: "Game", minPlayers: 2 },
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
    assert.match(root.text, /Viewer.*In-game/u);
    const ready = root.query((element) => element.tagName === "button" && element.textContent === "Ready");
    assert.equal(ready.disabled, false);
    const reminder = root.query((element) => element.textContent === "Ask everyone to return to lobby");
    assert.ok(reminder);
    reminder.dispatch("click");
    assert.equal(calls.includes("onAskResultsViewersToReturn"), true);

    state.localPlayerId = "viewer";
    renderApp(root, state, actions, {}, {});
    assert.equal(root.query((element) => element.tagName === "button" && element.textContent === "Ready").disabled, true);
    assert.equal(root.query((element) => element.textContent === "Ask everyone to return to lobby"), null);

    state.currentView = "game";
    state.resultsReminderSessionId = "finished-session";
    renderApp(root, state, actions, {}, {});
    assert.match(root.text, /The host is waiting in the lobby\./u);
    assert.match(root.text, /Return to Lobby\?/u);
    root.query((element) => element.textContent === "Wait").dispatch("click");
    root.query((element) => element.textContent === "OK").dispatch("click");
    assert.equal(calls.includes("onDismissResultsReminder"), true);
    assert.equal(calls.includes("onAcceptResultsReminder"), true);
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
