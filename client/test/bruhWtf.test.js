import assert from "node:assert/strict";
import test from "node:test";
import {
  isBruhWtfPublicState,
  renderBruhWtfGame,
  updateBruhSubmissionProgress,
  updateBruhVoteProgress,
} from "../src/games/bruhWtf.ts";

function withFakeDocument(run) {
  const original = globalThis.document;
  globalThis.document = {
    createElement() {
      return { dataset: {}, append() {} };
    },
  };
  try {
    run();
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.className = "";
    this.disabled = false;
    this.tabIndex = 0;
  }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  dispatch(type, event = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...event }); }
  get text() { return this.textContent + this.children.map((child) => child.text).join(""); }
  query(selector) {
    const found = this.children.find((child) => selector(child));
    return found ?? this.children.map((child) => child.query(selector)).find(Boolean) ?? null;
  }
}

function withFakeElements(run) {
  const original = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try { run(); }
  finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
}

function votingPublicState() {
  return {
    phase: "voting",
    currentRound: 2,
    totalRounds: 5,
    roundId: "round-2",
    prompt: "What would Alex do?",
    playerCount: 3,
    voteCount: 0,
    voteProgress: [
      { playerId: "local", name: "Alex", voted: false },
      { playerId: "remote-1", name: "Sam", voted: false },
      { playerId: "remote-2", name: "Riley", voted: false },
    ],
    options: [
      { id: "own", completion: "Alex answer", isOwnAnswer: true },
      { id: "other-1", completion: "Sam answer", isOwnAnswer: false },
      { id: "other-2", completion: "Riley answer", isOwnAnswer: false },
    ],
  };
}

function renderVoting(view, onSelectVote, onVote) {
  return renderBruhWtfGame(votingPublicState(), view, () => {}, () => {}, onSelectVote, onVote, () => {}, () => {}, "Bruh wtf?", false);
}

test("Bruh wtf remote submission progress retains an unsubmitted answer input", () => {
  withFakeDocument(() => {
    const progress = { textContent: "" };
    const chips = [];
    const list = {
      replaceChildren() { chips.length = 0; },
      append(item) { chips.push(item); },
    };
    const input = {
      value: "unfinished thought",
      selectionStart: 10,
      selectionEnd: 10,
      focused: true,
    };
    const root = {
      querySelector(selector) {
        if (selector === ".bruh-submission-progress") return progress;
        if (selector === ".bruh-submission-player-list") return list;
        if (selector === "#bruh-answer") return input;
        return null;
      },
    };
    const state = {
      phase: "answer-submission",
      currentRound: 1,
      totalRounds: 5,
      roundId: "round-1",
      prompt: "What would Alex do?",
      playerCount: 2,
      submissionCount: 1,
      submissionProgress: [
        { playerId: "local", name: "Alex", submitted: false },
        { playerId: "remote", name: "Sam", submitted: true },
      ],
    };
    assert.equal(isBruhWtfPublicState(state), true);
    assert.equal(updateBruhSubmissionProgress(root, state, "local"), true);
    assert.equal(progress.textContent, "1 of 2 answers submitted");
    assert.equal(chips.length, 2);
    assert.equal(root.querySelector("#bruh-answer"), input);
    assert.equal(input.value, "unfinished thought");
    assert.equal(input.selectionStart, 10);
    assert.equal(input.selectionEnd, 10);
    assert.equal(input.focused, true);
  });
});

test("Bruh wtf vote progress updates in place until the local vote is acknowledged", () => {
  const progress = { textContent: "" };
  const root = { querySelector: () => progress };
  const state = {
    phase: "voting",
    currentRound: 1,
    totalRounds: 5,
    roundId: "round-1",
    prompt: "What would Alex do?",
    playerCount: 2,
    voteCount: 1,
    voteProgress: [
      { playerId: "local", name: "Alex", voted: false },
      { playerId: "remote", name: "Sam", voted: true },
    ],
  };
  assert.equal(updateBruhVoteProgress(root, state, "local"), true);
  assert.equal(progress.textContent, "1 of 2 players voted");
  state.voteProgress[0].voted = true;
  assert.equal(updateBruhVoteProgress(root, state, "local"), false);
});

test("Bruh wtf voting matches Fact-or-Cap labels and shows own answer in the same non-selectable radio style", () => {
  withFakeElements(() => {
    const root = renderVoting({ currentPlayerId: "local", selectedOptionId: null }, () => {}, () => {});
    const heading = root.query((element) => element.tagName === "h1");
    const ownInput = root.query((element) => element.tagName === "input" && element.value === "own");
    const otherInput = root.query((element) => element.tagName === "input" && element.value === "other-1");
    const submit = root.query((element) => element.tagName === "button");
    assert.equal(heading.textContent, "Voting Round");
    assert.match(root.text, /Alex answer/u);
    assert.equal(ownInput.attributes["aria-disabled"], "true");
    assert.equal(ownInput.tabIndex, -1);
    assert.equal(ownInput.className, otherInput.className);
    assert.equal(ownInput.disabled, false);
    assert.equal(submit.textContent, "Submit");
    assert.equal(submit.disabled, true);
  });
});

test("selecting another answer enables Submit and submits the selected opaque option ID", () => {
  withFakeElements(() => {
    let selectedOptionId = null;
    let submittedOptionId = null;
    const root = renderVoting(
      { currentPlayerId: "local", selectedOptionId },
      (optionId) => { selectedOptionId = optionId; },
      (optionId) => { submittedOptionId = optionId; },
    );
    const otherInput = root.query((element) => element.tagName === "input" && element.value === "other-2");
    const submit = root.query((element) => element.tagName === "button");
    const form = root.query((element) => element.tagName === "form");
    otherInput.dispatch("change");
    assert.equal(selectedOptionId, "other-2");
    assert.equal(submit.disabled, false);
    form.dispatch("submit");
    assert.equal(submittedOptionId, "other-2");
  });
});

test("vote errors render as actionable alert feedback", () => {
  withFakeElements(() => {
    const root = renderVoting({ currentPlayerId: "local", selectedOptionId: "other-1", voteError: "You cannot vote for your own answer." }, () => {}, () => {});
    const alert = root.query((element) => element.attributes.role === "alert");
    assert.ok(alert);
    assert.equal(alert.textContent, "You cannot vote for your own answer.");
  });
});
