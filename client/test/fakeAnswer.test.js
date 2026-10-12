import assert from "node:assert/strict";
import test from "node:test";
import { createAnswerResultCard, createStandingsList } from "../src/ui/gamePresentation.ts";
import {
  FINAL_STATISTIC_LABELS,
  VOTING_ROUND_HEADING,
  formatRoundPoints,
  getPersonalRoundFeedback,
  getRevealAnswerGroups,
  renderFakeAnswerGame,
  updateFakeAnswerProgress,
} from "../src/games/fakeAnswer.ts";

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
  }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  dispatch(type, event = {}) { this.listeners[type]?.({ preventDefault() {}, stopPropagation() {}, ...event }); }
  get text() { return this.textContent + this.children.map((child) => child.text).join(""); }
  query(predicate) {
    return this.children.find(predicate) ?? this.children.map((child) => child.query(predicate)).find(Boolean) ?? null;
  }
}

function createResults(overrides = {}) {
  const results = {
    correctCompletion: "the real completion",
    options: [
      {
        id: "fake-option",
        completion: "the real completion",
        authorId: "player-2",
        authorName: "Player Two",
        isCorrect: false,
        voters: [{ playerId: "player-1", name: "Player One" }],
      },
      {
        id: "real-option",
        completion: "the real completion",
        authorId: null,
        authorName: null,
        isCorrect: true,
        voters: [{ playerId: "player-2", name: "Player Two" }],
      },
    ],
    players: [
      {
        playerId: "player-1",
        name: "Player One",
        submittedCompletion: "bluff one",
        voteOptionId: "fake-option",
        voteCompletion: "the real completion",
        voteCorrect: false,
        correctVotePoints: 0,
        bluffPoints: 0,
        roundPoints: 0,
        totalScore: 0,
      },
      {
        playerId: "player-2",
        name: "Player Two",
        submittedCompletion: "bluff two",
        voteOptionId: "real-option",
        voteCompletion: "the real completion",
        voteCorrect: true,
        correctVotePoints: 2,
        bluffPoints: 1,
        roundPoints: 3,
        totalScore: 3,
      },
    ],
    standings: [],
  };
  return { ...results, ...overrides };
}

test("remote submission progress updates without changing the active answer input", () => {
  const progress = { textContent: "", setAttribute() {} };
  const children = [];
  const playerList = {
    replaceChildren() {
      children.length = 0;
    },
    append(child) {
      children.push(child);
    },
    get children() {
      return children;
    },
  };
  const input = {
    value: "partial answer",
    selectionStart: 7,
    selectionEnd: 7,
    focused: true,
  };
  const root = {
    querySelector(selector) {
      return selector === ".submission-progress"
        ? progress
        : selector === ".submission-player-list"
          ? playerList
          : selector === "#fake-completion"
            ? input
            : null;
    },
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        dataset: {},
        className: "",
        append() {},
      };
    },
  };

  try {
    const updated = updateFakeAnswerProgress(root, {
      phase: "answer-submission",
      currentRound: 1,
      totalRounds: 5,
      roundId: "round-1",
      prompt: { id: "prompt-1", text: "Complete this sentence." },
      submissionCount: 1,
      playerCount: 2,
      submissionProgress: [
        { playerId: "local", name: "Local", submitted: false },
        { playerId: "remote", name: "Remote", submitted: true },
      ],
    }, "local");

    assert.equal(updated, true);
    assert.equal(progress.textContent, "1 of 2 answers submitted");
    assert.equal(children.length, 2);
    assert.equal(root.querySelector("#fake-completion"), input);
    assert.equal(input.value, "partial answer");
    assert.equal(input.selectionStart, 7);
    assert.equal(input.selectionEnd, 7);
    assert.equal(input.focused, true);
  } finally {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test("groups reveal answers by authoritative correctness rather than answer text", () => {
  const results = createResults();
  const groups = getRevealAnswerGroups(results.options);

  assert.equal(groups.realOption.id, "real-option");
  assert.deepEqual(
    groups.realOption.voters.map(({ name }) => name),
    ["Player Two"],
  );
  assert.deepEqual(
    groups.fakeOptions.map(({ id, completion, authorId, voters }) => ({
      id,
      completion,
      authorId,
      voterNames: voters.map(({ name }) => name),
    })),
    [{
      id: "fake-option",
      completion: "the real completion",
      authorId: "player-2",
      voterNames: ["Player One"],
    }],
  );
  assert.equal(groups.realOption.completion, "the real completion");
  assert.deepEqual(groups.realOption.voters.map(({ name }) => name), ["Player Two"]);
});

test("shared game display labels use current voting and final-statistic terminology", () => {
  assert.equal(VOTING_ROUND_HEADING, "Voting Round");
  assert.deepEqual(FINAL_STATISTIC_LABELS, [
    ["mostPlayersFooled", "Most players siked"],
    ["gotFooledMost", "Got siked the most"],
    ["mostCorrectAnswers", "Most correct answers"],
  ]);
});

test("round-point labels include an explicit sign for positive, zero, and negative deltas", () => {
  assert.equal(formatRoundPoints(3), "+3");
  assert.equal(formatRoundPoints(0), "+0");
  assert.equal(formatRoundPoints(-2), "-2");
});

test("personalized feedback follows the player's selected option ID", () => {
  const results = createResults();

  assert.deepEqual(getPersonalRoundFeedback(results, "player-2"), {
    outcome: "correct",
    title: "Correct!",
    detail: "+2 points",
  });
  assert.deepEqual(getPersonalRoundFeedback(results, "player-1"), {
    outcome: "fooled",
    title: "Sike!",
    detail: "Player Two got you!",
  });
});

test("missing or invalid votes produce neutral feedback", () => {
  const noVoteResults = createResults({
    players: createResults().players.map((player) => ({
      ...player,
      voteOptionId: "",
    })),
  });

  assert.deepEqual(getPersonalRoundFeedback(noVoteResults, "player-1"), {
    outcome: "neutral",
    title: "No vote submitted",
    detail: "",
  });
  assert.deepEqual(getPersonalRoundFeedback(createResults(), null), {
    outcome: "neutral",
    title: "No vote submitted",
    detail: "",
  });
});

test("Fact-or-Cap voting renderer retains shared voting labels, option markup, and submission callback", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const publicState = {
      phase: "voting",
      currentRound: 1,
      totalRounds: 5,
      roundId: "round-1",
      prompt: { id: "prompt-1", text: "Complete the prompt." },
      submissionCount: 3,
      playerCount: 3,
      voteCount: 0,
      voteProgress: [
        { playerId: "local", name: "Alex", voted: false },
        { playerId: "p2", name: "Sam", voted: false },
        { playerId: "p3", name: "Riley", voted: false },
      ],
      options: [
        { id: "real", completion: "REAL", isOwnAnswer: false },
        { id: "own", completion: "MY ANSWER", isOwnAnswer: true },
        { id: "fake-2", completion: "OTHER TWO", isOwnAnswer: false },
        { id: "fake-3", completion: "OTHER THREE", isOwnAnswer: false },
      ],
    };
    const submission = {
      currentPlayerId: "local", hasSubmitted: true, completionDraft: "", isSubmitting: false,
      submissionError: null, hasVoted: false, isVoting: false, selectedOptionId: null,
      voteError: null, isContinuing: false, continueError: null, isHost: false,
      isReturningToLobby: false, returnToLobbyError: null, isRoundFeedbackDismissed: true,
    };
    let selected = null;
    let submitted = null;
    const screen = renderFakeAnswerGame(
      publicState, submission, () => {}, (id) => { selected = id; }, (id) => { submitted = id; },
      () => {}, () => {}, "Fact or Cap", false, () => {},
    );
    const heading = screen.query((node) => node.tagName === "h1");
    const ownRadio = screen.query((node) => node.tagName === "input" && node.value === "own");
    const validRadio = screen.query((node) => node.tagName === "input" && node.value === "fake-2");
    const button = screen.query((node) => node.tagName === "button");
    const form = screen.query((node) => node.tagName === "form");
    assert.equal(heading.textContent, "Voting Round");
    assert.equal(ownRadio.attributes["aria-disabled"], "true");
    assert.equal(ownRadio.className, validRadio.className);
    assert.match(screen.text, /my answer/u);
    assert.equal(button.textContent, "Submit");
    assert.equal(button.disabled, true);
    validRadio.dispatch("change");
    assert.equal(selected, "fake-2");
    assert.equal(button.disabled, false);
    form.dispatch("submit");
    assert.equal(submitted, "fake-2");

    const animeScreen = renderFakeAnswerGame(
      publicState, submission, () => {}, () => {}, () => {}, () => {}, () => {},
      "Fact-or-Cap Anime", false, () => {},
    );
    assert.equal(animeScreen.query((node) => node.tagName === "h1").textContent, "Voting Round");
    assert.match(animeScreen.text, /Fact-or-Cap Anime/u);
    assert.match(animeScreen.text, /my answer/u);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("shared result cards and standings preserve Fact-or-Cap result presentation", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const card = createAnswerResultCard({
      completion: "REAL ANSWER",
      authorName: "Player Two",
      voteCount: 1,
      voterNames: ["Player One"],
      formatAnswer: (answer) => answer.toLowerCase(),
      voterPrefix: "Chosen by",
      noVotesText: "No one chose this answer.",
    });
    const correct = createAnswerResultCard({
      completion: "REAL ANSWER",
      authorName: null,
      voteCount: 2,
      voterNames: ["Player One", "Player Two"],
      formatAnswer: (answer) => answer.toLowerCase(),
      voterPrefix: "Chosen by",
      isCorrect: true,
    });
    const standings = createStandingsList([
      { playerId: "p1", name: "Player One", rank: 1, totalScore: 4 },
      { playerId: "p2", name: "Player Two", rank: 2, totalScore: 2 },
    ], { roundPointsByPlayer: new Map([["p1", 3], ["p2", -1]]) });
    assert.equal(card.className, "result-card");
    assert.match(card.text, /Player Two\|real answer/u);
    assert.match(card.text, /Chosen by: Player One/u);
    assert.equal(correct.className, "result-card result-card-correct real-answer-card");
    assert.match(correct.text, /2 votes/u);
    assert.equal(standings.className, "result-card-list standings-list");
    assert.match(standings.text, /\+3/u);
    assert.match(standings.text, /-1/u);
    assert.match(standings.text, /4 points/u);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
