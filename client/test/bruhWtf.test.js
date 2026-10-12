import assert from "node:assert/strict";
import test from "node:test";
import {
  isBruhWtfPublicState,
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
