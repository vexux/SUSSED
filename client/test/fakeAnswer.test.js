import assert from "node:assert/strict";
import test from "node:test";
import { createAnswerResultCard, createRoundHistorySection, createStandingsList } from "../src/ui/gamePresentation.ts";
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
  get firstElementChild() { return this.children.find((child) => !child.isTextNode) ?? null; }
  query(predicate) {
    return this.children.find(predicate) ?? this.children.map((child) => child.query(predicate)).find(Boolean) ?? null;
  }
}

function createResults(overrides = {}) {
  const results = {
    correctCompletion: "the real completion",
    roundPlayerCount: 2,
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

function createFinalPublicState(tied = true) {
  const firstScore = tied ? 9 : 6;
  const secondRank = tied ? 1 : 2;
  return {
    phase: "results",
    currentRound: 5,
    totalRounds: 5,
    roundId: "final-round",
    prompt: { id: "final-prompt", text: "This final prompt should not appear." },
    submissionCount: 2,
    playerCount: 2,
    isFinalRound: true,
    finalStatistics: {
      mostPlayersFooled: { count: 1, playerIds: ["player-1"] },
      gotFooledMost: { count: 0, playerIds: [] },
      mostCorrectAnswers: { count: 1, playerIds: ["player-2"] },
    },
    results: createResults({
      options: [
        ...createResults().options,
        { id: "extra-option", completion: "another answer", authorId: "player-1", authorName: "Player One", isCorrect: false, voters: [] },
      ],
      standings: [
        { playerId: "player-2", name: "Player Two", totalScore: 9, rank: 1 },
        { playerId: "player-1", name: "Player One", totalScore: firstScore, rank: secondRank },
      ],
    }),
  };
}

function createFinalView(overrides = {}) {
  return {
    currentPlayerId: "player-1", hasSubmitted: true, completionDraft: "", isSubmitting: false,
    submissionError: null, hasVoted: true, isVoting: false, selectedOptionId: null,
    voteError: null, isContinuing: false, continueError: null, isHost: true,
    isReturningToLobby: false, returnToLobbyError: null, isRoundFeedbackDismissed: true,
    ...overrides,
  };
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
    ["mostPlayersFooled", "Professional Liar"],
    ["gotFooledMost", "Gullible Legend"],
    ["mostCorrectAnswers", "The Nerd"],
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
    assert.equal(screen.query((node) => node.className === "round-counter").textContent, "Round 1 of 5");
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

test("Fact-or-Cap final screens show the shared winner card and leaderboard without a phase heading or round counter", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const renderFinal = (gameName, state, view = createFinalView(), onReturn = () => {}, onReturnFromResults = () => {}) =>
      renderFakeAnswerGame(state, view, () => {}, () => {}, () => {}, () => {}, onReturn, gameName, true, () => {}, undefined, undefined, onReturnFromResults);

    const tieState = createFinalPublicState(true);
    const screen = renderFinal("Fact or Cap", tieState);
    const winnerCard = screen.children[0];
    const leaderboardHeading = screen.children[1];
    const leaderboard = screen.children[2];
    assert.equal(winnerCard.className, "final-winner-card");
    assert.equal(winnerCard.children[0].textContent, "🏆");
    assert.equal(winnerCard.children[1].tagName, "h1");
    assert.match(winnerCard.text, /It's a tie!/u);
    assert.match(winnerCard.text, /Player Two, Player One/u);
    assert.match(winnerCard.text, /9 points/u);
    assert.equal(leaderboardHeading.textContent, "Final leaderboard");
    assert.equal(leaderboard.className.includes("final-leaderboard"), true);
    assert.deepEqual(leaderboard.children.map((row) => row.children[0].textContent), ["#1", "#1"]);
    assert.equal(screen.children.indexOf(leaderboard), screen.children.indexOf(winnerCard) + 2);
    assert.doesNotMatch(screen.text, /Final results|Round 5 of 5|final prompt should not appear|Correct Answer|Bluff answers/u);
    assert.equal(screen.query((node) => node.tagName === "button" && node.textContent === "Return to lobby").textContent, "Return to lobby");

    const animeScreen = renderFinal("Fact-or-Cap Anime", tieState);
    assert.equal(animeScreen.children[0].className, "final-winner-card");
    assert.equal(animeScreen.query((node) => node.tagName === "h1").textContent, "It's a tie!");
    assert.match(animeScreen.text, /Player Two, Player One/u);
    assert.doesNotMatch(animeScreen.text, /Final results|Round 5 of 5/u);
    assert.equal(animeScreen.query((node) => node.className === "round-counter"), null);

    const singleScreen = renderFinal("Fact or Cap", createFinalPublicState(false));
    const singleWinner = singleScreen.children[0];
    assert.equal(singleScreen.query((node) => node.tagName === "h1").textContent, "Winner");
    assert.match(singleWinner.text, /Winner/u);
    assert.match(singleWinner.text, /Player Two/u);
    assert.doesNotMatch(singleWinner.text, /Player One/u);
    assert.deepEqual(singleScreen.children[2].children.map((row) => row.children[0].textContent), ["#1", "#2"]);

    const departureState = createFinalPublicState(false);
    departureState.playerCount = 2;
    departureState.results.roundPlayerCount = 3;
    departureState.results.players.push({
      playerId: "departed-player", name: "Departed Player", submittedCompletion: "kept answer",
      voteOptionId: null, voteCompletion: null, voteCorrect: null,
      correctVotePoints: 0, bluffPoints: 1, roundPoints: 1, totalScore: 1,
    });
    departureState.results.standings.push({
      playerId: "departed-player", name: "Departed Player", totalScore: 1, rank: 3,
    });
    const departureScreen = renderFinal("Fact or Cap", departureState);
    assert.match(departureScreen.text, /Departed Player/u);
    assert.match(departureScreen.text, /1 point/u);

    let returnCalls = 0;
    const hostScreen = renderFinal("Fact or Cap", tieState, createFinalView(), () => { returnCalls += 1; });
    hostScreen.query((node) => node.tagName === "button" && node.textContent === "Return to lobby").dispatch("click");
    assert.equal(returnCalls, 1);

    const returningScreen = renderFinal("Fact or Cap", tieState, createFinalView({ isReturningToLobby: true, returnToLobbyError: "Return failed" }));
    const returning = returningScreen.query((node) => node.tagName === "button" && node.textContent.includes("Returning to lobby"));
    assert.equal(returning.disabled, true);
    assert.match(returning.textContent, /Returning to lobby/u);
    assert.match(returningScreen.text, /Return failed/u);

    const nonHostScreen = renderFinal("Fact or Cap", tieState, createFinalView({ isHost: false }));
    assert.equal(nonHostScreen.query((node) => node.tagName === "button" && node.textContent === "Return to lobby"), null);
    assert.match(nonHostScreen.text, /Waiting for the host/u);

    let viewerReturnCalls = 0;
    let hostReturnCalls = 0;
    const viewerScreen = renderFinal(
      "Fact or Cap",
      tieState,
      createFinalView({ isHost: true, isResultsViewer: true }),
      () => { hostReturnCalls += 1; },
      () => { viewerReturnCalls += 1; },
    );
    const viewerReturn = viewerScreen.query((node) => node.tagName === "button" && node.className === "primary-button");
    assert.ok(viewerReturn);
    viewerReturn.dispatch("click");
    assert.equal(hostReturnCalls, 0);
    assert.equal(viewerReturnCalls, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("ordinary question and round-results screens retain their heading and round counter", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const submission = createFinalView({ isRoundFeedbackDismissed: true });
    const question = renderFakeAnswerGame({
      phase: "question", currentRound: 2, totalRounds: 5, roundId: "round-2",
      prompt: { id: "prompt", text: "Ordinary prompt" }, submissionCount: 0, playerCount: 2,
    }, submission, () => {}, () => {}, () => {}, () => {}, () => {}, "Fact or Cap", false, () => {});
    assert.equal(question.query((node) => node.tagName === "h1").textContent, "Question");
    assert.equal(question.query((node) => node.className === "round-counter").textContent, "Round 2 of 5");

    const roundState = createFinalPublicState(false);
    roundState.currentRound = 4;
    roundState.isFinalRound = false;
    delete roundState.finalStatistics;
    roundState.results = createResults({
      ...roundState.results,
      options: [
        ...createResults().options,
        { id: "extra-option", completion: "another answer", authorId: "player-1", authorName: "Player One", isCorrect: false, voters: [] },
      ],
      standings: [
        { playerId: "player-2", name: "Player Two", totalScore: 9, rank: 1 },
        { playerId: "player-1", name: "Player One", totalScore: 6, rank: 2 },
      ],
    });
    roundState.continueReadyCount = 0;
    roundState.continuePlayerCount = 2;
    roundState.viewerReadyToContinue = false;
    roundState.continueProgress = [
      { playerId: "player-1", name: "Player One", ready: false },
      { playerId: "player-2", name: "Player Two", ready: false },
    ];
    const roundResults = renderFakeAnswerGame(roundState, submission, () => {}, () => {}, () => {}, () => {}, () => {}, "Fact or Cap", false, () => {});
    assert.equal(roundResults.query((node) => node.tagName === "h1").textContent, "Round results");
    assert.equal(roundResults.query((node) => node.className === "round-counter").textContent, "Round 4 of 5");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("all-round history opens on the final round and supports bounded page navigation", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => {
      const node = new FakeElement("#text");
      node.isTextNode = true;
      node.textContent = text;
      return node;
    },
  };
  try {
    const history = [1, 2, 3].map((round) => ({
      gameName: "Fact or Cap Anime",
      round,
      prompt: `Prompt ${round}`,
      sections: [{
        heading: "Bluff answers",
        voterPrefix: "Chosen by",
        answers: [{
          completion: `Answer ${round}`, authorName: "Alex", voterNames: ["Sam"], voteCount: 1,
        }],
      }],
      standings: [{ playerId: "alex", name: "Alex", rank: 1, totalScore: round }],
      roundPointsByPlayer: new Map([["alex", 1]]),
    }));
    let toggleCount = 0;
    let selectedPage = null;
    const section = createRoundHistorySection(history, -1, true, () => toggleCount++, (page) => { selectedPage = page; });
    assert.match(section.text, /Round 3 results/u);
    assert.match(section.text, /Prompt 3/u);
    assert.match(section.text, /Fact or Cap Anime/u);
    assert.match(section.text, /Alex/u);
    assert.match(section.text, /Answer 3/u);
    assert.match(section.text, /1 vote/u);
    assert.match(section.text, /Chosen by: Sam/u);
    assert.match(section.text, /Current leaderboard/u);
    assert.match(section.text, /#1/u);
    assert.match(section.text, /\+1/u);
    assert.match(section.text, /3 points/u);
    assert.equal(section.query((node) => node.textContent === "Continue"), null);
    const previous = section.query((node) => node.attributes?.["aria-label"] === "Previous round");
    const next = section.query((node) => node.attributes?.["aria-label"] === "Next round");
    assert.equal(previous.disabled, false);
    assert.equal(next.disabled, true);
    previous.dispatch("click");
    assert.equal(selectedPage, 1);
    const pageOne = section.query((node) => node.attributes?.["aria-label"] === "Round 1");
    pageOne.dispatch("click");
    assert.equal(selectedPage, 0);
    section.query((node) => node.textContent === "Hide All Round Results").dispatch("click");
    assert.equal(toggleCount, 1);
    const malformedHistory = createRoundHistorySection([{
      gameName: "Fact or Cap",
      round: 4,
      prompt: "Must not be shown without a valid snapshot",
      sections: [],
      standings: [],
      roundPointsByPlayer: null,
    }], -1, true, () => {}, () => {});
    assert.doesNotMatch(malformedHistory.text, /Must not be shown/u);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("Fact-or-Cap historical snapshots render their recorded answers, voters, and leaderboard", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const state = createFinalPublicState(false);
    state.results.roundHistory = [{
      ...createResults(),
      round: 4,
      prompt: "Recorded round prompt",
      standings: [
        { playerId: "player-2", name: "Player Two", totalScore: 6, rank: 1 },
        { playerId: "player-1", name: "Player One", totalScore: 3, rank: 2 },
      ],
      players: createResults().players.map((player) => ({
        ...player,
        roundPoints: player.playerId === "player-2" ? 3 : 0,
        totalScore: player.playerId === "player-2" ? 6 : 3,
      })),
    }];
    const screen = renderFakeAnswerGame(
      state,
      createFinalView({ historyOpen: true }),
      () => {}, () => {}, () => {}, () => {}, () => {},
      "Fact-or-Cap Anime", true, () => {}, () => {}, () => {},
    );
    assert.match(screen.text, /Fact-or-Cap Anime/u);
    assert.match(screen.text, /Round 4 results/u);
    assert.match(screen.text, /Recorded round prompt/u);
    assert.match(screen.text, /Correct Answer/u);
    assert.match(screen.text, /Bluff answers/u);
    assert.match(screen.text, /Chosen by: Player Two/u);
    assert.match(screen.text, /Current leaderboard/u);
    assert.match(screen.text, /\+3/u);
    assert.match(screen.text, /6 points/u);
    assert.doesNotMatch(screen.text, /Continue/u);
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
