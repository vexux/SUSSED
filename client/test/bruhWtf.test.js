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
      const item = { dataset: {}, className: "", append() {} };
      item.classList = { add(...names) { item.className = [...new Set(`${item.className} ${names.join(" ")}`.trim().split(/\s+/u))].join(" "); } };
      return item;
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
    this.dataset = {};
    this.textContent = "";
    this.className = "";
    this.disabled = false;
    this.tabIndex = 0;
    this.classList = {
      add: (...names) => {
        this.className = [...new Set(`${this.className} ${names.join(" ")}`.trim().split(/\s+/u))].join(" ");
      },
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  dispatch(type, event = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...event }); }
  get text() { return this.textContent + this.children.map((child) => child.text).join(""); }
  query(selector) {
    const found = this.children.find((child) => selector(child));
    return found ?? this.children.map((child) => child.query(selector)).find(Boolean) ?? null;
  }
  queryAll(selector) {
    return [
      ...this.children.filter(selector),
      ...this.children.flatMap((child) => child.queryAll(selector)),
    ];
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
      get children() { return chips; },
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
  withFakeElements(() => {
  const progress = { textContent: "" };
  const input = { checked: true, value: "selected-option" };
  const chips = [];
  const list = {
    replaceChildren() { chips.length = 0; },
    append(item) { chips.push(item); },
    get children() { return chips; },
  };
  const root = {
    querySelector(selector) {
      if (selector === ".bruh-vote-progress") return progress;
      if (selector === ".bruh-vote-player-list") return list;
      if (selector === "#selected-option") return input;
      return null;
    },
  };
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
  assert.equal(chips.length, 2);
  assert.equal(root.querySelector("#selected-option"), input);
  assert.equal(input.checked, true);
  state.voteProgress[0].voted = true;
  assert.equal(updateBruhVoteProgress(root, state, "local"), false);
  });
});

test("Bruh round results show answer details and authoritative round deltas in tied leaderboard rows", () => {
  withFakeElements(() => {
    const state = {
      phase: "results",
      currentRound: 2,
      totalRounds: 5,
      roundId: "round-2",
      prompt: "What would Alex do?",
      playerCount: 3,
      continueReadyCount: 1,
      continuePlayerCount: 3,
      viewerReadyToContinue: false,
      continueProgress: [
        { playerId: "local", name: "Alex", ready: true },
        { playerId: "p2", name: "Sam", ready: false },
        { playerId: "p3", name: "Riley", ready: false },
      ],
      results: {
        prompt: "What would Alex do?",
        answers: [
          { completion: "a long answer ".repeat(10), authorId: "local", authorName: "Alex", voterNames: [], voteCount: 0, pointsAwarded: 0 },
          { completion: "second answer", authorId: "p2", authorName: "Sam", voterNames: ["Alex"], voteCount: 1, pointsAwarded: 1 },
          { completion: "third answer", authorId: "p3", authorName: "Riley", voterNames: ["Alex", "Riley"], voteCount: 2, pointsAwarded: 2 },
        ],
        roundScores: [
          { playerId: "local", name: "Alex", pointsEarned: 0 },
          { playerId: "p2", name: "Sam", pointsEarned: 1 },
          { playerId: "p3", name: "Riley", pointsEarned: 2 },
        ],
        leaderboard: [
          { playerId: "p3", name: "Riley", score: 4, rank: 1 },
          { playerId: "local", name: "Alex", score: 4, rank: 1 },
          { playerId: "p2", name: "Sam", score: 2, rank: 3 },
        ],
      },
    };
    const root = renderBruhWtfGame(state, {
      currentPlayerId: "local", answerDraft: "", isSubmitting: false, submitError: null,
      selectedOptionId: null, hasVoted: false, isVoting: false, voteError: null,
      isContinuing: false, continueError: null, isHost: false,
      isReturningToLobby: false, returnToLobbyError: null,
    }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, "Bruh wtf?", false);
    assert.equal(root.queryAll((node) => node.className.split(" ").includes("result-card")).length, 6);
    assert.match(root.text, /Alex\|/u);
    assert.match(root.text, /Voted by: Alex/u);
    assert.match(root.text, /1 vote/u);
    assert.match(root.text, /No votes/u);
    assert.doesNotMatch(root.text, /points this round/u);
    assert.doesNotMatch(root.text, /Round points/u);
    assert.match(root.text, /Current leaderboard/u);
    assert.match(root.text, /1 \/ 3 players ready to continue/u);
    assert.match(root.text, /Alex.*Ready/u);
    const answerList = root.query((node) => node.tagName === "ul" && node.className.includes("result-card-list"));
    assert.equal(answerList.children.length, 3);
    assert.doesNotMatch(answerList.children[0].text, /points this round/u);
    const leaderboard = root.query((node) => node.tagName === "ol" && node.className.includes("standings-list"));
    const [first, second, third] = leaderboard.children;
    assert.deepEqual(first.children.map(({ textContent }) => textContent), ["#1", "Riley", "+2", "4 points"]);
    assert.equal(first.children[2].className, "standing-round-score standing-round-score-positive");
    assert.deepEqual(second.children.map(({ textContent }) => textContent), ["#1", "Alex", "+0", "4 points"]);
    assert.equal(second.children[2].className, "standing-round-score");
    assert.deepEqual(third.children.map(({ textContent }) => textContent), ["#3", "Sam", "+1", "2 points"]);
    assert.equal(third.children[2].className, "standing-round-score standing-round-score-positive");
  });
});

test("Bruh final results omit round content and show tied winners, final leaderboard, and host control", () => {
  withFakeElements(() => {
    let returnCalls = 0;
    const root = renderBruhWtfGame({
      phase: "results", currentRound: 5, totalRounds: 5, roundId: "final", prompt: "Final prompt must not be shown", playerCount: 3,
      results: {
        prompt: "Final prompt must not be shown",
        answers: [{ completion: "final answer", authorId: "p1", authorName: "Alex", voterNames: [], voteCount: 0, pointsAwarded: 0 }],
        roundScores: [{ playerId: "p1", name: "Alex", pointsEarned: 0 }],
        leaderboard: [
          { playerId: "p1", name: "Alex", score: 8, rank: 1 },
          { playerId: "p2", name: "Sam", score: 8, rank: 1 },
          { playerId: "p3", name: "Riley", score: 4, rank: 3 },
        ],
        winners: [{ playerId: "p1", name: "Alex" }, { playerId: "p2", name: "Sam" }],
      },
    }, {
      currentPlayerId: "p1", answerDraft: "", isSubmitting: false, submitError: null,
      selectedOptionId: null, hasVoted: false, isVoting: false, voteError: null,
      isContinuing: false, continueError: null, isHost: true,
      isReturningToLobby: false, returnToLobbyError: null,
    }, () => {}, () => {}, () => {}, () => {}, () => {}, () => { returnCalls += 1; }, "Bruh wtf?", true);
    assert.match(root.text, /It's a tie!/u);
    assert.match(root.text, /Alex, Sam/u);
    assert.match(root.text, /Final leaderboard/u);
    assert.match(root.text, /Return to lobby/u);
    assert.doesNotMatch(root.text, /Final prompt|Round 5 of 5|Answers|Round points|final answer|points this round/u);
    assert.equal(root.query((node) => node.tagName === "h1"), null);
    assert.equal(root.queryAll((node) => node.className.split(" ").includes("result-card")).length, 3);
    const leaderboard = root.query((node) => node.tagName === "ol" && node.className.includes("final-leaderboard"));
    assert.deepEqual(leaderboard.children.map((row) => row.children[0].textContent), ["#1", "#1", "#3"]);
    const returnButton = root.query((node) => node.tagName === "button");
    returnButton.dispatch("click");
    assert.equal(returnCalls, 1);
  });
});

test("Bruh final results preserve return loading/errors and non-host waiting state", () => {
  withFakeElements(() => {
    const state = {
      phase: "results", currentRound: 5, totalRounds: 5, roundId: "final", prompt: "Hidden prompt", playerCount: 2,
      results: {
        prompt: "Hidden prompt", answers: [], roundScores: [],
        leaderboard: [{ playerId: "p1", name: "Alex", score: 8, rank: 1 }],
        winners: [{ playerId: "p1", name: "Alex" }],
      },
    };
    const baseView = {
      currentPlayerId: "p1", answerDraft: "", isSubmitting: false, submitError: null,
      selectedOptionId: null, hasVoted: false, isVoting: false, voteError: null,
      isContinuing: false, continueError: null, isHost: true,
      isReturningToLobby: true, returnToLobbyError: "Return failed",
    };
    const host = renderBruhWtfGame(state, baseView, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, "Bruh wtf?", true);
    const button = host.query((node) => node.tagName === "button");
    assert.equal(button.disabled, true);
    assert.match(button.textContent, /Returning to lobby/u);
    assert.match(host.text, /Return failed/u);

    const nonHost = renderBruhWtfGame(state, { ...baseView, isHost: false, isReturningToLobby: false, returnToLobbyError: null }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, "Bruh wtf?", true);
    assert.equal(nonHost.query((node) => node.tagName === "button"), null);
    assert.match(nonHost.text, /Waiting for the host/u);
  });
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
